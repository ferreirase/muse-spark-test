import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed, SEED_CREATED_AT } from '../../db/seed.js';
import { createWorker } from './worker.js';
import { runSaga } from '../transfers/saga/orchestrator.js';
import { checkInvariants } from '../transfers/saga/invariants.js';
import { debitStep } from '../transfers/saga/steps.js';

let dir: string;
let db: Database.Database;
const baseTime = Date.parse('2026-10-01T12:00:00.000Z');
const clock = () => new Date(baseTime + Date.now() % 1_000_000);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-worker-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

function makeTransfer(id: string, src = 'acc-alice', dst = 'acc-bruno') {
  db.prepare(
    "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',NULL,'CREATED',0,0,?,?,?,?)",
  ).run(id, src, dst, 100, null, `key-${id}`, 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
  db.prepare("INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,'PENDING',?,?,?)")
    .run(`job-${id}`, id, SEED_CREATED_AT, SEED_CREATED_AT, SEED_CREATED_AT);
}

const status = (id: string) => (db.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status;

describe('worker', () => {
  it('3 transferências → todas COMPLETED com invariantes ok', async () => {
    makeTransfer('t1'); makeTransfer('t2'); makeTransfer('t3');
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga });
    w.start();
    await vi.waitFor(() => {
      expect(status('t1')).toBe('COMPLETED');
      expect(status('t2')).toBe('COMPLETED');
      expect(status('t3')).toBe('COMPLETED');
    }, { timeout: 4000 });
    await w.stop();
    expect(checkInvariants(db)).toMatchObject({ totalCents: 125000, negativeBalances: 0 });
  });

  it('saga bloqueada não impede outra de completar (concorrência)', async () => {
    makeTransfer('t-blocked');
    makeTransfer('t-free');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fake = (deps: Parameters<typeof runSaga>[0], id: string) =>
      id === 't-blocked' ? gate.then(() => runSaga(deps, id)) : runSaga(deps, id);
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga: fake });
    w.start();
    await vi.waitFor(() => expect(status('t-free')).toBe('COMPLETED'), { timeout: 4000 });
    expect(status('t-blocked')).toBe('PENDING');
    expect(w.isIdle()).toBe(false);
    release();
    await vi.waitFor(() => expect(status('t-blocked')).toBe('COMPLETED'), { timeout: 4000 });
    await w.stop();
  });

  it('RETRY_LATER reagenda com run_after futuro e status não terminal', async () => {
    makeTransfer('t1');
    let calls = 0;
    const flaky = (deps: Parameters<typeof runSaga>[0], id: string) => {
      calls++;
      if (calls <= 1) return Promise.resolve('RETRY_LATER' as const);
      return runSaga(deps, id);
    };
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga: flaky });
    w.start();
    await vi.waitFor(() => expect(status('t1')).toBe('COMPLETED'), { timeout: 5000 });
    await w.stop();
    const job = db.prepare('SELECT run_after, attempts, status FROM jobs WHERE transfer_id=?').get('t1') as Record<string, unknown>;
    expect(job.status).toBe('DONE');
    expect(Number(job.attempts)).toBeGreaterThanOrEqual(1);
    expect(job.run_after).not.toBe(SEED_CREATED_AT); // foi reagendado
  });

  it('recuperação pós-reinício: DEBITED + lock antigo → novo worker completa sem duplicar', async () => {
    makeTransfer('t1');
    debitStep(db, 't1', new Date(baseTime));
    // simula crash com lock preso
    db.prepare('UPDATE jobs SET locked_by=?, locked_until=? WHERE transfer_id=?').run('worker-morto', new Date(baseTime + 60000).toISOString(), 't1');
    const file = join(dir, 's.sqlite');
    db.close();
    const db2 = openDatabase(file);
    const w = createWorker({ db: db2, clock, pollIntervalMs: 5, runSaga });
    w.start();
    await vi.waitFor(() => {
      const s = (db2.prepare('SELECT status FROM transfers WHERE id=?').get('t1') as { status: string }).status;
      expect(s).toBe('COMPLETED');
    }, { timeout: 4000 });
    await w.stop();
    const count = (sql: string, ...a: unknown[]) => (db2.prepare(sql).get(...a) as { c: number }).c;
    expect(count("SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id='t1' AND type='DEBIT'")).toBe(1);
    expect(count("SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id='t1' AND type='CREDIT'")).toBe(1);
    db = openDatabase(file); // para o afterEach
  });

  it('stop() aguarda in-flight terminar', async () => {
    makeTransfer('t1');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = (deps: Parameters<typeof runSaga>[0], id: string) =>
      gate.then(() => runSaga(deps, id));
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga: slow });
    w.start();
    await vi.waitFor(() => expect(w.isIdle()).toBe(false), { timeout: 4000 });
    const stopped = w.stop();
    let stoppedFlag = false;
    void stopped.then(() => { stoppedFlag = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(stoppedFlag).toBe(false);
    release();
    await stopped;
    expect(stoppedFlag).toBe(true);
    expect(status('t1')).toBe('COMPLETED');
  });

  it('pause()/resume() controlam o loop para o reset', async () => {
    makeTransfer('t1');
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga });
    w.start();
    w.pause();
    await new Promise((r) => setTimeout(r, 60));
    expect(status('t1')).toBe('PENDING');
    expect(w.isIdle()).toBe(true);
    w.resume();
    await vi.waitFor(() => expect(status('t1')).toBe('COMPLETED'), { timeout: 4000 });
    await w.stop();
  });
});
