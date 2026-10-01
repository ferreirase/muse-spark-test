import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed, SEED_CREATED_AT } from '../../db/seed.js';
import { createPauseRegistry } from './pause-registry.js';
import { resetAll } from './reset-all.js';
import { createWorker, type Worker } from '../worker/worker.js';
import { runSaga } from '../transfers/saga/orchestrator.js';

let dir: string;
let db: Database.Database;
const baseTime = Date.parse('2026-10-01T12:00:00.000Z');
const clock = () => new Date(baseTime + (Date.now() % 1_000_000));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-reset-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeTransfer(id: string) {
  db.prepare(
    "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',NULL,'CREATED',0,0,?,?,?,?)",
  ).run(id, 'acc-alice', 'acc-bruno', 100, null, `key-${id}`, 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
  db.prepare("INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,'PENDING',?,?,?)")
    .run(`job-${id}`, id, SEED_CREATED_AT, SEED_CREATED_AT, SEED_CREATED_AT);
}

const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
const status = (id: string) => (db.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status;

describe('resetAll', () => {
  it('com saga bloqueada: aborta, espera idle, restaura seed e worker volta a processar', async () => {
    makeTransfer('t-blocked');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const registry = createPauseRegistry();

    const fake = (deps: Parameters<typeof runSaga>[0], id: string) => {
      if (id !== 't-blocked') return runSaga(deps, id);
      return new Promise<'COMPLETED' | 'FAILED' | 'RETRY_LATER'>((resolve) => {
        const onAbort = () => resolve('RETRY_LATER');
        deps.signal?.addEventListener('abort', onAbort);
        void gate.then(() => {
          deps.signal?.removeEventListener('abort', onAbort);
          resolve(runSaga(deps, id));
        });
      });
    };

    const w: Worker = createWorker({ db, clock, pollIntervalMs: 5, runSaga: fake, pauseRegistry: registry });
    w.start();
    await vi.waitFor(() => expect(w.isIdle()).toBe(false), { timeout: 4000 });

    // suja o banco com sessão/contato/transferência extra
    db.prepare('INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)')
      .run('s1', 'h', 'user-alice', SEED_CREATED_AT, '2027-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?)')
      .run('c-x', 'user-carla', 'acc-bruno', 'B', SEED_CREATED_AT);

    await resetAll({ db, worker: w, registry, timeoutMs: 3000 });

    expect(count('sessions')).toBe(0);
    expect(count('transfers')).toBe(0);
    expect(count('jobs')).toBe(0);
    expect(count('ledger_entries')).toBe(0);
    expect(count('contacts')).toBe(1);
    expect((db.prepare('SELECT SUM(balance_cents) s FROM accounts').get() as { s: number }).s).toBe(125000);

    // worker retoma: nova transferência completa
    makeTransfer('t-after');
    await vi.waitFor(() => expect(status('t-after')).toBe('COMPLETED'), { timeout: 4000 });
    await w.stop();
    release();
  });

  it('sempre dá resume no worker, mesmo se o reset lançar', async () => {
    const registry = createPauseRegistry();
    const w = createWorker({ db, clock, pollIntervalMs: 5, runSaga });
    w.start();
    const failing = {} as unknown as Database.Database; // qualquer chamada lança
    await expect(
      resetAll({ db: failing, worker: w, registry, timeoutMs: 500 }),
    ).rejects.toThrow();
    // worker não fica pausado para sempre: processa nova transferência
    makeTransfer('t2');
    await vi.waitFor(() => expect(status('t2')).toBe('COMPLETED'), { timeout: 4000 });
    await w.stop();
  });
});
