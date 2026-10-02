import { randomUUID } from "node:crypto";
import type { SqliteDb } from "../../db/connection.js";
import type { Clock } from "../../shared/clock.js";

export type FaultMode = "FAIL_CREDIT_ONCE" | "PAUSE_AFTER_DEBIT";

export interface FaultRow {
  id: string;
  source_account_id: string;
  idempotency_key: string;
  mode: FaultMode;
  armed_at: string;
  consumed_at: string | null;
  transfer_id: string | null;
}

export interface ArmFaultInput {
  sourceAccountId: string;
  idempotencyKey: string;
  mode: FaultMode;
}

export interface ArmFaultDeps {
  db: SqliteDb;
  clock: Clock;
  generateId?: () => string;
}

export function armFault(deps: ArmFaultDeps, input: ArmFaultInput): FaultRow {
  const id = (deps.generateId ?? randomUUID)();
  const nowIso = deps.clock.now().toISOString();
  deps.db
    .prepare(
      `INSERT INTO test_faults
         (id, source_account_id, idempotency_key, mode, armed_at, consumed_at, transfer_id)
       VALUES (@id, @source, @key, @mode, @now, NULL, NULL)
       ON CONFLICT (source_account_id, idempotency_key)
       DO UPDATE SET mode = excluded.mode,
                     armed_at = excluded.armed_at,
                     consumed_at = NULL,
                     transfer_id = NULL`,
    )
    .run({
      id,
      source: input.sourceAccountId,
      key: input.idempotencyKey,
      mode: input.mode,
      now: nowIso,
    });

  return deps.db
    .prepare(
      "SELECT * FROM test_faults WHERE source_account_id = ? AND idempotency_key = ?",
    )
    .get(input.sourceAccountId, input.idempotencyKey) as FaultRow;
}

export function consumeFault(
  deps: { db: SqliteDb; clock: Clock },
  sourceAccountId: string,
  idempotencyKey: string,
  transferId: string,
): FaultMode | null {
  const nowIso = deps.clock.now().toISOString();
  const run = deps.db.transaction((): FaultMode | null => {
    const fault = deps.db
      .prepare(
        `SELECT * FROM test_faults
          WHERE source_account_id = ? AND idempotency_key = ? AND consumed_at IS NULL`,
      )
      .get(sourceAccountId, idempotencyKey) as FaultRow | undefined;
    if (!fault) return null;

    const claim = deps.db
      .prepare(
        `UPDATE test_faults
            SET consumed_at = ?, transfer_id = ?
          WHERE id = ? AND consumed_at IS NULL`,
      )
      .run(nowIso, transferId, fault.id);
    if (claim.changes === 0) return null;
    return fault.mode;
  });
  return run.immediate();
}

export function clearFaults(db: SqliteDb): void {
  db.prepare("DELETE FROM test_faults").run();
}
