import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed, SEED_CREATED_AT } from '../../db/seed.js';
import {
  releaseAllLocks, findDueJobs, claimJob, rescheduleJob, unlockJob,
} from './job-repository.js';

let dir: string;
let db: Database.Database;
const NOW = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-jobs-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeJob(id: string, over: Record<string, unknown> = {}) {
  const t = {
    id,
    source_account_id: 'acc-alice', recipient_account_id: 'acc-bruno', amount_cents: 100,
    note: null, status: 'PENDING', failure_code: null, saga_step: 'CREATED',
    in_transit_cents: 0, attempts: 0, last_error: null,
    idempotency_key: `key-${id}`, payload_fingerprint: 'fp',
    created_at: SEED_CREATED_AT, updated_at: SEED_CREATED_AT,
  };
  db.prepare(`INSERT INTO transfers (${Object.keys(t).join(',')}) VALUES (${Object.keys(t).map(() => '?').join(',')})`)
    .run(...Object.values(t));
  const j = { id: `job-${id}`, transfer_id: id, status: 'PENDING', run_after: SEED_CREATED_AT, attempts: 0, locked_by: null, locked_until: null, last_error: null, created_at: SEED_CREATED_AT, updated_at: SEED_CREATED_AT, ...over };
  db.prepare(`INSERT INTO jobs (${Object.keys(j).join(',')}) VALUES (${Object.keys(j).map(() => '?').join(',')})`)
    .run(...Object.values(j));
}

describe('job repository', () => {
  it('claim duplo: só o primeiro vence', () => {
    makeJob('t1');
    expect(claimJob(db, 'job-t1', 'w1', NOW.toISOString(), 60000)).toBe(true);
    expect(claimJob(db, 'job-t1', 'w2', NOW.toISOString(), 60000)).toBe(false);
  });

  it('lease expirado permite novo claim', () => {
    makeJob('t1');
    claimJob(db, 'job-t1', 'w1', NOW.toISOString(), 1000);
    const later = new Date(NOW.getTime() + 2000);
    expect(claimJob(db, 'job-t1', 'w2', later.toISOString(), 60000)).toBe(true);
  });

  it('findDueJobs respeita run_after e locked_until', () => {
    makeJob('t1'); // devido agora
    makeJob('t2', { run_after: new Date(NOW.getTime() + 60000).toISOString() }); // futuro
    makeJob('t3'); // devido, mas travado
    claimJob(db, 'job-t3', 'w1', NOW.toISOString(), 60000);
    const due = findDueJobs(db, NOW.toISOString(), 10) as { transfer_id: string }[];
    expect(due.map((j) => j.transfer_id)).toEqual(['t1']);
  });

  it('releaseAllLocks libera locks de execução anterior', () => {
    makeJob('t1');
    claimJob(db, 'job-t1', 'w1', NOW.toISOString(), 60000);
    releaseAllLocks(db);
    const due = findDueJobs(db, NOW.toISOString(), 10) as { transfer_id: string }[];
    expect(due.map((j) => j.transfer_id)).toEqual(['t1']);
    expect(claimJob(db, 'job-t1', 'w2', NOW.toISOString(), 60000)).toBe(true);
  });

  it('rescheduleJob move run_after, registra erro e limpa lock', () => {
    makeJob('t1');
    claimJob(db, 'job-t1', 'w1', NOW.toISOString(), 60000);
    const later = new Date(NOW.getTime() + 5000).toISOString();
    rescheduleJob(db, 'job-t1', later, ' deu ruim');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get('job-t1') as Record<string, unknown>;
    expect(job.run_after).toBe(later);
    expect(job.last_error).toBe(' deu ruim');
    expect(job.locked_by).toBeNull();
    expect(job.locked_until).toBeNull();
    expect(job.attempts).toBe(1);
  });

  it('unlockJob limpa lock sem mudar run_after', () => {
    makeJob('t1');
    claimJob(db, 'job-t1', 'w1', NOW.toISOString(), 60000);
    unlockJob(db, 'job-t1');
    const job = db.prepare('SELECT locked_by, locked_until, run_after FROM jobs WHERE id=?').get('job-t1') as Record<string, unknown>;
    expect(job.locked_by).toBeNull();
    expect(job.run_after).toBe(SEED_CREATED_AT);
  });
});
