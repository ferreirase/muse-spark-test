import { randomUUID } from 'node:crypto';
import type { Db } from '../../db/connection.js';

export type FaultMode = 'FAIL_CREDIT_ONCE' | 'PAUSE_AFTER_DEBIT';

export const IDEMPOTENCY_KEY_PATTERN = '^[A-Za-z0-9._:-]{8,128}$';

/** Repositório de faults (tabela test_faults). */

export function armFault(
  db: Db,
  args: { sourceAccountId: string; idempotencyKey: string; mode: FaultMode; now: string },
): void {
  const id = `fault-${randomUUID()}`;
  db.prepare(
    `INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at, consumed_at, transfer_id)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(source_account_id, idempotency_key)
     DO UPDATE SET mode=excluded.mode, armed_at=excluded.armed_at, consumed_at=NULL, transfer_id=NULL`,
  ).run(id, args.sourceAccountId, args.idempotencyKey, args.mode, args.now);
}

export interface ArmedFault {
  id: string;
  mode: FaultMode;
}

/** Fault armada e não consumida para (source, key). */
export function findArmedFault(db: Db, sourceAccountId: string, idempotencyKey: string): ArmedFault | null {
  const row = db
    .prepare(
      `SELECT id, mode FROM test_faults
       WHERE source_account_id=? AND idempotency_key=? AND consumed_at IS NULL`,
    )
    .get(sourceAccountId, idempotencyKey) as ArmedFault | undefined;
  return row ?? null;
}

/** Marca consumo (persistido antes de pausar/falhar). Retorna true se consumiu agora. */
export function consumeFault(
  db: Db,
  args: { sourceAccountId: string; idempotencyKey: string; mode: FaultMode; transferId: string; now: string },
): boolean {
  const r = db
    .prepare(
      `UPDATE test_faults SET consumed_at=?, transfer_id=?
       WHERE source_account_id=? AND idempotency_key=? AND mode=? AND consumed_at IS NULL`,
    )
    .run(args.now, args.transferId, args.sourceAccountId, args.idempotencyKey, args.mode);
  return r.changes === 1;
}

export function pendingPauseCount(db: Db): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM test_faults WHERE mode='PAUSE_AFTER_DEBIT' AND consumed_at IS NOT NULL`).get() as { n: number }).n;
}
