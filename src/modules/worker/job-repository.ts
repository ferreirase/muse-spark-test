import type { SqliteDb } from "../../db/connection.js";

export interface JobRow {
  id: string;
  transfer_id: string;
  status: "PENDING" | "DONE";
  run_after: string;
  attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClaimOptions {
  workerId: string;
  nowIso: string;
  leaseMs: number;
}

export function recoverStaleLocks(db: SqliteDb, nowIso: string): number {
  const result = db
    .prepare(
      `UPDATE jobs
          SET locked_by = NULL, locked_until = NULL, updated_at = ?
        WHERE status = 'PENDING'
          AND locked_by IS NOT NULL
          AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(nowIso, nowIso);
  return result.changes;
}

export function claimNextJob(
  db: SqliteDb,
  options: ClaimOptions,
): JobRow | undefined {
  const run = db.transaction((): JobRow | undefined => {
    const candidate = db
      .prepare(
        `SELECT * FROM jobs
          WHERE status = 'PENDING'
            AND run_after <= ?
            AND (locked_by IS NULL OR locked_until IS NULL OR locked_until < ?)
          ORDER BY run_after ASC, created_at ASC
          LIMIT 1`,
      )
      .get(options.nowIso, options.nowIso) as JobRow | undefined;
    if (!candidate) return undefined;

    const lockedUntil = new Date(
      new Date(options.nowIso).getTime() + options.leaseMs,
    ).toISOString();
    const claim = db
      .prepare(
        `UPDATE jobs
            SET locked_by = ?, locked_until = ?, updated_at = ?
          WHERE id = ?
            AND status = 'PENDING'
            AND (locked_by IS NULL OR locked_until IS NULL OR locked_until < ?)`,
      )
      .run(
        options.workerId,
        lockedUntil,
        options.nowIso,
        candidate.id,
        options.nowIso,
      );
    if (claim.changes === 0) return undefined;

    return { ...candidate, locked_by: options.workerId, locked_until: lockedUntil };
  });
  return run.immediate();
}

export function completeJob(
  db: SqliteDb,
  transferId: string,
  nowIso: string,
): void {
  db.prepare(
    `UPDATE jobs
        SET status = 'DONE', locked_by = NULL, locked_until = NULL, updated_at = ?
      WHERE transfer_id = ?`,
  ).run(nowIso, transferId);
}

export function rescheduleJob(
  db: SqliteDb,
  transferId: string,
  options: { runAfter: string; lastError: string | null; nowIso: string },
): void {
  db.prepare(
    `UPDATE jobs
        SET status = 'PENDING',
            locked_by = NULL,
            locked_until = NULL,
            run_after = ?,
            attempts = attempts + 1,
            last_error = ?,
            updated_at = ?
      WHERE transfer_id = ? AND status = 'PENDING'`,
  ).run(options.runAfter, options.lastError, options.nowIso, transferId);
}

export function findJobByTransferId(
  db: SqliteDb,
  transferId: string,
): JobRow | undefined {
  return db
    .prepare("SELECT * FROM jobs WHERE transfer_id = ?")
    .get(transferId) as JobRow | undefined;
}
