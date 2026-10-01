import type { Db } from '../../../db/connection.js';

export type SagaStep = 'CREATED' | 'DEBITED' | 'COMPENSATING' | 'COMPLETED' | 'FAILED';
export type StepResult = 'APPLIED' | 'ALREADY_APPLIED' | 'INSUFFICIENT_FUNDS';

/** Falha definitiva de crédito: orquestrador deve compensar. */
export class CreditFailedError extends Error {
  override name = 'CreditFailedError';
  constructor(message: string) {
    super(message);
  }
}

interface TransferRow {
  id: string;
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
  saga_step: SagaStep;
}

/** Cria transfer + job em CREATED/PENDING (usado pelo comando e pelos testes). */
export function insertCreatedTransfer(
  db: Db,
  args: {
    id: string;
    sourceAccountId: string;
    recipientAccountId: string;
    amountCents: number;
    note: string | null;
    idempotencyKey: string;
    fingerprint: string;
    now: string;
  },
): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO transfers (id, source_account_id, recipient_account_id, amount_cents, note,
         status, failure_code, saga_step, in_transit_cents, attempts, last_error,
         idempotency_key, payload_fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', NULL, 'CREATED', 0, 0, NULL, ?, ?, ?, ?)`,
    ).run(
      args.id,
      args.sourceAccountId,
      args.recipientAccountId,
      args.amountCents,
      args.note,
      args.idempotencyKey,
      args.fingerprint,
      args.now,
      args.now,
    );
    db.prepare(
      `INSERT INTO jobs (id, transfer_id, status, run_after, attempts, locked_by, locked_until, last_error, created_at, updated_at)
       VALUES (?, ?, 'PENDING', ?, 0, NULL, NULL, NULL, ?, ?)`,
    ).run(`job-${args.id}`, args.id, args.now, args.now, args.now);
  });
  tx.immediate();
}

function getTransfer(db: Db, id: string): TransferRow | undefined {
  return db
    .prepare(
      `SELECT id, source_account_id, recipient_account_id, amount_cents, saga_step
       FROM transfers WHERE id = ?`,
    )
    .get(id) as TransferRow | undefined;
}

/**
 * Passo 1: débito condicionado a saldo. Guarda CREATED → DEBITED.
 * Saldo insuficiente → FAILED/INSUFFICIENT_FUNDS + job DONE, sem ledger.
 */
export function debitStep(db: Db, transferId: string, now: string): StepResult {
  const tx = db.transaction((): StepResult => {
    const t = getTransfer(db, transferId);
    if (t === undefined) throw new Error(`transferência inexistente: ${transferId}`);
    if (t.saga_step !== 'CREATED') return 'ALREADY_APPLIED';

    const guard = db
      .prepare(
        `UPDATE transfers SET saga_step='DEBITED', status='PROCESSING',
           in_transit_cents=amount_cents, updated_at=?
         WHERE id=? AND saga_step='CREATED'`,
      )
      .run(now, transferId);
    if (guard.changes === 0) return 'ALREADY_APPLIED';

    const debit = db
      .prepare(
        `UPDATE accounts SET balance_cents = balance_cents - ?, updated_at = ?
         WHERE id = ? AND balance_cents >= ?`,
      )
      .run(t.amount_cents, now, t.source_account_id, t.amount_cents);
    if (debit.changes === 0) {
      db.prepare(
        `UPDATE transfers SET saga_step='FAILED', status='FAILED',
           failure_code='INSUFFICIENT_FUNDS', in_transit_cents=0, updated_at=?
         WHERE id=?`,
      ).run(now, transferId);
      db.prepare(`UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=?`).run(now, transferId);
      return 'INSUFFICIENT_FUNDS';
    }

    db.prepare(
      `INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'DEBIT', ?, ?)`,
    ).run(`ledger-${transferId}-DEBIT`, transferId, t.source_account_id, -t.amount_cents, now);
    return 'APPLIED';
  });
  return tx.immediate() as StepResult;
}

/**
 * Passo 2: crédito + COMPLETED no mesmo commit. Guarda DEBITED → COMPLETED.
 * Conta destinatária inexistente → CreditFailedError (rollback total do passo).
 */
export function creditStep(db: Db, transferId: string, now: string): StepResult {
  const tx = db.transaction((): StepResult => {
    const t = getTransfer(db, transferId);
    if (t === undefined) throw new Error(`transferência inexistente: ${transferId}`);
    if (t.saga_step !== 'DEBITED') return 'ALREADY_APPLIED';

    const hasDebit = db
      .prepare(`SELECT 1 FROM ledger_entries WHERE transfer_id=? AND type='DEBIT'`)
      .get(transferId);
    if (hasDebit === undefined) {
      throw new CreditFailedError(`débito não registrado para ${transferId}`);
    }

    const credit = db
      .prepare(
        `UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(t.amount_cents, now, t.recipient_account_id);
    if (credit.changes === 0) {
      throw new CreditFailedError(`conta destinatária inexistente: ${t.recipient_account_id}`);
    }

    db.prepare(
      `INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'CREDIT', ?, ?)`,
    ).run(`ledger-${transferId}-CREDIT`, transferId, t.recipient_account_id, t.amount_cents, now);

    db.prepare(
      `UPDATE transfers SET saga_step='COMPLETED', status='COMPLETED',
         in_transit_cents=0, updated_at=?
       WHERE id=? AND saga_step='DEBITED'`,
    ).run(now, transferId);
    db.prepare(`UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=?`).run(now, transferId);
    return 'APPLIED';
  });
  return tx.immediate() as StepResult;
}

/** Registra falha definitiva de crédito: DEBITED → COMPENSATING. */
export function markCompensating(db: Db, transferId: string, reason: string, now: string): StepResult {
  const tx = db.transaction((): StepResult => {
    const t = getTransfer(db, transferId);
    if (t === undefined) throw new Error(`transferência inexistente: ${transferId}`);
    if (t.saga_step === 'COMPENSATING' || t.saga_step === 'FAILED' || t.saga_step === 'COMPLETED') {
      return 'ALREADY_APPLIED';
    }
    if (t.saga_step !== 'DEBITED') return 'ALREADY_APPLIED';
    const guard = db
      .prepare(
        `UPDATE transfers SET saga_step='COMPENSATING', status='PROCESSING',
           last_error=?, updated_at=?
         WHERE id=? AND saga_step='DEBITED'`,
      )
      .run(reason, now, transferId);
    return guard.changes === 0 ? 'ALREADY_APPLIED' : 'APPLIED';
  });
  return tx.immediate() as StepResult;
}

/**
 * Passo 3: reembolso por soma (nunca snapshot) + FAILED/CREDIT_FAILED.
 * Guarda COMPENSATING → FAILED.
 */
export function compensateStep(db: Db, transferId: string, now: string): StepResult {
  const tx = db.transaction((): StepResult => {
    const t = getTransfer(db, transferId);
    if (t === undefined) throw new Error(`transferência inexistente: ${transferId}`);
    if (t.saga_step !== 'COMPENSATING') return 'ALREADY_APPLIED';

    db.prepare(
      `UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ?
       WHERE id = ?`,
    ).run(t.amount_cents, now, t.source_account_id);

    db.prepare(
      `INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, 'COMPENSATION', ?, ?)`,
    ).run(
      `ledger-${transferId}-COMPENSATION`,
      transferId,
      t.source_account_id,
      t.amount_cents,
      now,
    );

    const guard = db
      .prepare(
        `UPDATE transfers SET saga_step='FAILED', status='FAILED',
           failure_code='CREDIT_FAILED', in_transit_cents=0, updated_at=?
         WHERE id=? AND saga_step='COMPENSATING'`,
      )
      .run(now, transferId);
    if (guard.changes === 0) return 'ALREADY_APPLIED';
    db.prepare(`UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=?`).run(now, transferId);
    return 'APPLIED';
  });
  return tx.immediate() as StepResult;
}
