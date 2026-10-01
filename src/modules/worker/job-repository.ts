import type Database from 'better-sqlite3';

export interface JobRow {
  id: string;
  transfer_id: string;
  status: string;
  run_after: string;
  attempts: number;
  locked_by: string | null;
  locked_until: string | null;
  last_error: string | null;
}

/**
 * Job table como outbox durável (PRD §5): claim condicional com lease,
 * reagenda com backoff, recuperação de locks no boot.
 * Limitação documentada: um worker por arquivo SQLite.
 */

/** Libera locks de execuções anteriores (chamado no start do worker). */
export function releaseAllLocks(db: Database.Database): void {
  db.prepare('UPDATE jobs SET locked_by = NULL, locked_until = NULL WHERE locked_by IS NOT NULL').run();
}

export function findDueJobs(db: Database.Database, nowIso: string, limit: number): JobRow[] {
  return db
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'PENDING' AND run_after <= ?
         AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY created_at
       LIMIT ?`,
    )
    .all(nowIso, nowIso, limit) as JobRow[];
}

/** Claim atômico: só vence se o job estiver livre ou com lease expirada. */
export function claimJob(db: Database.Database, jobId: string, workerId: string, nowIso: string, leaseMs: number): boolean {
  const lockedUntil = new Date(new Date(nowIso).getTime() + leaseMs).toISOString();
  const r = db
    .prepare(
      `UPDATE jobs SET locked_by = ?, locked_until = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(workerId, lockedUntil, nowIso, jobId, nowIso);
  return r.changes > 0;
}

export function rescheduleJob(db: Database.Database, jobId: string, runAfterIso: string, error: string | null): void {
  db.prepare(
    `UPDATE jobs SET run_after = ?, last_error = ?, attempts = attempts + 1,
       locked_by = NULL, locked_until = NULL, updated_at = ? WHERE id = ?`,
  ).run(runAfterIso, error, runAfterIso, jobId);
}

export function unlockJob(db: Database.Database, jobId: string): void {
  db.prepare('UPDATE jobs SET locked_by = NULL, locked_until = NULL WHERE id = ?').run(jobId);
}
