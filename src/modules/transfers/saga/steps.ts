import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../../db/connection.js";
import type { Clock } from "../../../shared/clock.js";
import {
  CreditFailedError,
  InsufficientFundsError,
  TransferNotFoundError,
} from "./errors.js";

export interface SagaStepDeps {
  db: SqliteDb;
  clock: Clock;
  generateId?: () => string;
}

export type DebitOutcome = "DEBITED" | "INSUFFICIENT_FUNDS" | "ALREADY_APPLIED";
export type StepOutcome = "APPLIED" | "ALREADY_APPLIED";

interface TransferFinancials {
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  saga_step: string;
  status: string;
}

function loadFinancials(db: SqliteDb, transferId: string): TransferFinancials {
  const row = db
    .prepare(
      `SELECT source_account_id, recipient_account_id, amount_cents, saga_step, status
         FROM transfers WHERE id = ?`,
    )
    .get(transferId) as TransferFinancials | undefined;
  if (!row) throw new TransferNotFoundError(transferId);
  return row;
}

function id(deps: SagaStepDeps): string {
  return (deps.generateId ?? randomUUID)();
}

export function stepDebit(
  deps: SagaStepDeps,
  transferId: string,
): DebitOutcome {
  const { db } = deps;
  const nowIso = deps.clock.now().toISOString();

  const run = db.transaction((): DebitOutcome => {
    const transfer = loadFinancials(db, transferId);
    if (transfer.saga_step !== "CREATED") return "ALREADY_APPLIED";

    const claim = db
      .prepare(
        `UPDATE transfers
            SET saga_step = 'DEBITED',
                status = 'PROCESSING',
                in_transit_cents = amount_cents,
                attempts = attempts + 1,
                updated_at = ?
          WHERE id = ? AND saga_step = 'CREATED'`,
      )
      .run(nowIso, transferId);
    if (claim.changes === 0) return "ALREADY_APPLIED";

    const debit = db
      .prepare(
        `UPDATE accounts
            SET balance_cents = balance_cents - ?, updated_at = ?
          WHERE id = ? AND balance_cents >= ?`,
      )
      .run(
        transfer.amount_cents,
        nowIso,
        transfer.source_account_id,
        transfer.amount_cents,
      );
    if (debit.changes === 0) {
      throw new InsufficientFundsError();
    }

    db.prepare(
      `INSERT INTO ledger_entries
         (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'DEBIT', ?, ?)`,
    ).run(
      id(deps),
      transferId,
      transfer.source_account_id,
      -transfer.amount_cents,
      nowIso,
    );

    return "DEBITED";
  });

  try {
    return run.immediate();
  } catch (error) {
    if (error instanceof InsufficientFundsError) return "INSUFFICIENT_FUNDS";
    throw error;
  }
}

export function stepMarkInsufficientFunds(
  deps: SagaStepDeps,
  transferId: string,
): StepOutcome {
  const { db } = deps;
  const nowIso = deps.clock.now().toISOString();
  const run = db.transaction((): StepOutcome => {
    const claim = db
      .prepare(
        `UPDATE transfers
            SET status = 'FAILED',
                saga_step = 'FAILED',
                failure_code = 'INSUFFICIENT_FUNDS',
                in_transit_cents = 0,
                updated_at = ?
          WHERE id = ? AND saga_step = 'CREATED'`,
      )
      .run(nowIso, transferId);
    if (claim.changes === 0) return "ALREADY_APPLIED";
    db.prepare(
      `UPDATE jobs SET status = 'DONE', locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE transfer_id = ?`,
    ).run(nowIso, transferId);
    return "APPLIED";
  });
  return run.immediate();
}

export function stepCredit(deps: SagaStepDeps, transferId: string): StepOutcome {
  const { db } = deps;
  const nowIso = deps.clock.now().toISOString();
  const run = db.transaction((): StepOutcome => {
    const transfer = loadFinancials(db, transferId);
    if (transfer.saga_step !== "DEBITED") return "ALREADY_APPLIED";

    const claim = db
      .prepare(
        `UPDATE transfers
            SET saga_step = 'COMPLETED',
                status = 'COMPLETED',
                failure_code = NULL,
                in_transit_cents = 0,
                updated_at = ?
          WHERE id = ? AND saga_step = 'DEBITED'`,
      )
      .run(nowIso, transferId);
    if (claim.changes === 0) return "ALREADY_APPLIED";

    const credit = db
      .prepare(
        `UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(transfer.amount_cents, nowIso, transfer.recipient_account_id);
    if (credit.changes === 0) {
      throw new CreditFailedError("recipient account is not credit-able");
    }

    db.prepare(
      `INSERT INTO ledger_entries
         (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'CREDIT', ?, ?)`,
    ).run(
      id(deps),
      transferId,
      transfer.recipient_account_id,
      transfer.amount_cents,
      nowIso,
    );

    db.prepare(
      `UPDATE jobs SET status = 'DONE', locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE transfer_id = ?`,
    ).run(nowIso, transferId);

    return "APPLIED";
  });
  return run.immediate();
}

export function stepMarkCompensating(
  deps: SagaStepDeps,
  transferId: string,
): StepOutcome {
  const { db } = deps;
  const nowIso = deps.clock.now().toISOString();
  const run = db.transaction((): StepOutcome => {
    const claim = db
      .prepare(
        `UPDATE transfers
            SET saga_step = 'COMPENSATING',
                status = 'PROCESSING',
                failure_code = 'CREDIT_FAILED',
                updated_at = ?
          WHERE id = ? AND saga_step = 'DEBITED'`,
      )
      .run(nowIso, transferId);
    return claim.changes === 0 ? "ALREADY_APPLIED" : "APPLIED";
  });
  return run.immediate();
}

export function stepCompensate(
  deps: SagaStepDeps,
  transferId: string,
): StepOutcome {
  const { db } = deps;
  const nowIso = deps.clock.now().toISOString();
  const run = db.transaction((): StepOutcome => {
    const transfer = loadFinancials(db, transferId);
    if (transfer.saga_step !== "COMPENSATING") return "ALREADY_APPLIED";

    const claim = db
      .prepare(
        `UPDATE transfers
            SET saga_step = 'FAILED',
                status = 'FAILED',
                failure_code = 'CREDIT_FAILED',
                in_transit_cents = 0,
                updated_at = ?
          WHERE id = ? AND saga_step = 'COMPENSATING'`,
      )
      .run(nowIso, transferId);
    if (claim.changes === 0) return "ALREADY_APPLIED";

    db.prepare(
      `UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ?
        WHERE id = ?`,
    ).run(transfer.amount_cents, nowIso, transfer.source_account_id);

    db.prepare(
      `INSERT INTO ledger_entries
         (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'COMPENSATION', ?, ?)`,
    ).run(
      id(deps),
      transferId,
      transfer.source_account_id,
      transfer.amount_cents,
      nowIso,
    );

    db.prepare(
      `UPDATE jobs SET status = 'DONE', locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE transfer_id = ?`,
    ).run(nowIso, transferId);

    return "APPLIED";
  });
  return run.immediate();
}
