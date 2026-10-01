import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import { insertCreatedTransfer } from '../transfers/saga/steps.js';
import { claimJob, findDueJobs, readJob, releaseAllLocks, rescheduleJob } from './job-repository.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-jobs-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 's.sqlite'));
  dbs.push(db);
  migrate(db);
  await seed(db);
  return db;
}

afterEach(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
  }
  dbs = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const T = '2026-10-01T19:00:00.000Z';

describe('job-repository', () => {
  it('claim duplo: só o primeiro vence; lease expirado libera', async () => {
    const db = await freshDb();
    insertCreatedTransfer(db, { id: 'j1', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno', amountCents: 10, note: null, idempotencyKey: 'kj1', fingerprint: 'fp', now: T });
    expect(claimJob(db, 'job-j1', 'w1', T, '2026-10-01T19:01:00.000Z')).toBe(true);
    expect(claimJob(db, 'job-j1', 'w2', T, '2026-10-01T19:01:00.000Z')).toBe(false);
    // Lease expirado: novo claim vence.
    expect(claimJob(db, 'job-j1', 'w2', '2026-10-01T19:02:00.000Z', '2026-10-01T19:03:00.000Z')).toBe(true);
    expect(readJob(db, 'j1')?.status).toBe('PENDING');
  });

  it('findDueJobs respeita run_after e status; reschedule + release', async () => {
    const db = await freshDb();
    insertCreatedTransfer(db, { id: 'j2', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno', amountCents: 10, note: null, idempotencyKey: 'kj2', fingerprint: 'fp', now: T });
    rescheduleJob(db, 'job-j2', '2026-10-01T20:00:00.000Z', 'x', T);
    expect(findDueJobs(db, T, 10)).toEqual([]);
    expect(findDueJobs(db, '2026-10-01T20:00:00.000Z', 10).map((j) => j.transferId)).toEqual(['j2']);
    db.prepare(`UPDATE jobs SET locked_by='w-x', locked_until='2030-01-01T00:00:00.000Z' WHERE id='job-j2'`).run();
    expect(releaseAllLocks(db)).toBe(1);
    expect(findDueJobs(db, '2026-10-01T20:00:00.000Z', 10).map((j) => j.transferId)).toEqual(['j2']);
  });
});
