import type { Db } from '../../db/connection.js';

export interface DueJob {
  id: string;
  transferId: string;
  attempts: number;
}

/** Libera todos os locks (boot: assume um worker por arquivo). */
export function releaseAllLocks(db: Db): number {
  const r = db.prepare(`UPDATE jobs SET locked_by=NULL, locked_until=NULL WHERE locked_by IS NOT NULL`).run();
  return Number(r.changes);
}

/** Jobs devidos: PENDING, run_after vencido e sem lock válido. */
export function findDueJobs(db: Db, now: string, limit: number): DueJob[] {
  return db
    .prepare(
      `SELECT id, transfer_id AS transferId, attempts
       FROM jobs
       WHERE status='PENDING' AND run_after <= ?
         AND (locked_until IS NULL OR locked_until < ?)
       ORDER BY created_at, id
       LIMIT ?`,
    )
    .all(now, now, limit) as DueJob[];
}

/** Claim condicional com lease. true = este worker é dono. */
export function claimJob(db: Db, jobId: string, workerId: string, now: string, leaseUntil: string): boolean {
  const r = db
    .prepare(
      `UPDATE jobs SET locked_by=?, locked_until=?, updated_at=?
       WHERE id=? AND status='PENDING' AND (locked_until IS NULL OR locked_until < ?)`,
    )
    .run(workerId, leaseUntil, now, jobId, now);
  return r.changes === 1;
}

export function rescheduleJob(db: Db, jobId: string, runAfter: string, error: string | null, now: string): void {
  db.prepare(
    `UPDATE jobs SET run_after=?, last_error=?, locked_by=NULL, locked_until=NULL, updated_at=?
     WHERE id=? AND status='PENDING'`,
  ).run(runAfter, error, now, jobId);
}

export function unlockJob(db: Db, jobId: string, now: string): void {
  db.prepare(`UPDATE jobs SET locked_by=NULL, locked_until=NULL, updated_at=? WHERE id=?`).run(now, jobId);
}

export function readJob(db: Db, transferId: string): { status: string; attempts: number; runAfter: string } | undefined {
  return db.prepare(`SELECT status, attempts, run_after AS runAfter FROM jobs WHERE transfer_id=?`).get(transferId) as
    | { status: string; attempts: number; runAfter: string }
    | undefined;
}
