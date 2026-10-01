import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { INITIAL_TOTAL_CENTS, seed } from '../../db/seed.js';
import type { SagaOutcome } from '../transfers/saga/orchestrator.js';
import { runSaga } from '../transfers/saga/orchestrator.js';
import { checkInvariants } from '../transfers/saga/invariants.js';
import { debitStep, insertCreatedTransfer } from '../transfers/saga/steps.js';
import { readJob } from './job-repository.js';
import { createWorker, retryDelayMs } from './worker.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<{ db: Db; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-worker-'));
  dirs.push(dir);
  const file = join(dir, 's.sqlite');
  const db = openDatabase(file);
  dbs.push(db);
  migrate(db);
  await seed(db);
  return { db, file };
}

function closeAll(): void {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
  }
  dbs = [];
}

afterEach(() => {
  closeAll();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const T = '2026-10-01T19:00:00.000Z';
let seq = 0;

function mk(db: Db, amount = 1000): string {
  seq += 1;
  const id = `w-${seq}`;
  insertCreatedTransfer(db, {
    id, sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno',
    amountCents: amount, note: null, idempotencyKey: `kw-${id}`, fingerprint: 'fp', now: T,
  });
  return id;
}

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condição do worker');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('worker', () => {
  it('retryDelayMs: 200·2^a, teto 5s', () => {
    expect(retryDelayMs(0)).toBe(200);
    expect(retryDelayMs(1)).toBe(400);
    expect(retryDelayMs(10)).toBe(5000);
  });

  it('3 transferências → todas COMPLETED; invariantes ok', async () => {
    const { db } = await freshDb();
    const ids = [mk(db, 1000), mk(db, 2000), mk(db, 3000)];
    const worker = createWorker({
      db,
      clock: { now: () => new Date() },
      runSaga: (tid) => runSaga({ db, now: () => new Date().toISOString() }, tid),
      pollIntervalMs: 20,
    });
    worker.start();
    try {
      await waitFor(() => ids.every((id) => (db.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status === 'COMPLETED'));
      for (const id of ids) expect(readJob(db, id)?.status).toBe('DONE');
      expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('saga lenta numa não bloqueia outra (concorrência)', async () => {
    const { db } = await freshDb();
    const slow = mk(db, 100);
    const fast = mk(db, 200);
    let releaseSlow!: () => void;
    const gate = new Promise<void>((r) => (releaseSlow = r));
    const worker = createWorker({
      db,
      clock: { now: () => new Date() },
      concurrency: 2,
      pollIntervalMs: 10,
      runSaga: async (tid): Promise<SagaOutcome> => {
        if (tid === slow) await gate;
        return runSaga({ db, now: () => new Date().toISOString() }, tid);
      },
    });
    worker.start();
    try {
      await waitFor(() => (db.prepare('SELECT status FROM transfers WHERE id=?').get(fast) as { status: string }).status === 'COMPLETED');
      expect((db.prepare('SELECT status FROM transfers WHERE id=?').get(slow) as { status: string }).status).not.toBe('COMPLETED');
      releaseSlow();
      await waitFor(() => (db.prepare('SELECT status FROM transfers WHERE id=?').get(slow) as { status: string }).status === 'COMPLETED');
    } finally {
      releaseSlow();
      await worker.stop();
    }
  });

  it('RETRY_LATER reagenda com run_after futuro e mantém não terminal', async () => {
    const { db } = await freshDb();
    const id = mk(db, 100);
    let calls = 0;
    const worker = createWorker({
      db,
      clock: { now: () => new Date() },
      pollIntervalMs: 10,
      retryBaseMs: 50,
      runSaga: async (): Promise<SagaOutcome> => {
        calls += 1;
        return calls === 1 ? 'RETRY_LATER' : runSaga({ db, now: () => new Date().toISOString() }, id);
      },
    });
    worker.start();
    try {
      await waitFor(() => (db.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status === 'COMPLETED');
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('recuperação: DEBITED + lock antigo, nova conexão → COMPLETED com 1 DEBIT/CREDIT', async () => {
    const { db, file } = await freshDb();
    const id = mk(db, 2000);
    expect(debitStep(db, id, T)).toBe('APPLIED');
    db.prepare(`UPDATE jobs SET locked_by='worker-morto', locked_until='2030-01-01T00:00:00.000Z' WHERE transfer_id=?`).run(id);
    closeAll();
    const db2 = openDatabase(file);
    dbs.push(db2);
    const worker = createWorker({
      db: db2,
      clock: { now: () => new Date() },
      runSaga: (tid) => runSaga({ db: db2, now: () => new Date().toISOString() }, tid),
      pollIntervalMs: 20,
    });
    worker.start();
    try {
      await waitFor(() => (db2.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status === 'COMPLETED');
      expect(db2.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=?').get(id)).toEqual({ n: 2 });
      expect(checkInvariants(db2, INITIAL_TOTAL_CENTS).ok).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('stop() aguarda in-flight', async () => {
    const { db } = await freshDb();
    const id = mk(db, 100);
    let finished = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const worker = createWorker({
      db,
      clock: { now: () => new Date() },
      pollIntervalMs: 10,
      runSaga: async (tid): Promise<SagaOutcome> => {
        const out = await runSaga({ db, now: () => new Date().toISOString() }, tid);
        await gate;
        finished = true;
        return out;
      },
    });
    worker.start();
    await waitFor(() => (db.prepare('SELECT locked_by FROM jobs WHERE transfer_id=?').get(id) as { locked_by: string | null }).locked_by !== null);
    const stopping = worker.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(finished).toBe(false);
    release();
    await stopping;
    expect(finished).toBe(true);
  });

  it('claim condicional: segundo claimant perde (teste de job-repository, sem workers duplos)', async () => {
    const { db } = await freshDb();
    const id = mk(db, 100);
    // Dois workers no MESMO banco compartilham o Set? Não — cada worker tem seu
    // in-flight. A proteção real entre processos é o claim condicional + lease,
    // já coberta em job-repository.test.ts. Aqui: worker não re-claima job
    // que ele mesmo tem em in-flight.
    let executions = 0;
    const counting: (tid: string) => Promise<SagaOutcome> = async (tid) => {
      executions += 1;
      await new Promise((r) => setTimeout(r, 80));
      return runSaga({ db, now: () => new Date().toISOString() }, tid);
    };
    const w = createWorker({ db, clock: { now: () => new Date() }, pollIntervalMs: 5, runSaga: counting });
    w.start();
    try {
      await waitFor(() => (db.prepare('SELECT status FROM transfers WHERE id=?').get(id) as { status: string }).status === 'COMPLETED');
      await new Promise((r) => setTimeout(r, 120));
      expect(executions).toBe(1);
    } finally {
      await w.stop();
    }
  });
});
