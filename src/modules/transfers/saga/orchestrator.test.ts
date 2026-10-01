import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { INITIAL_TOTAL_CENTS, seed } from '../../../db/seed.js';
import { checkInvariants } from './invariants.js';
import { runSaga } from './orchestrator.js';
import { debitStep, insertCreatedTransfer } from './steps.js';

let dirs: string[] = [];
let dbs: Db[] = [];
let files: string[] = [];

async function freshDb(): Promise<{ db: Db; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-orch-'));
  dirs.push(dir);
  const file = join(dir, 's.sqlite');
  files.push(file);
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
  files = [];
});

const T = '2026-10-01T19:00:00.000Z';
let seq = 0;
const fastRetry = { attempts: 5, baseMs: 1, sleep: async () => undefined, random: () => 0 };

function mk(db: Db, overrides: Partial<{ src: string; dst: string; amount: number; id: string }> = {}): string {
  seq += 1;
  const id = overrides.id ?? `o${seq}`;
  insertCreatedTransfer(db, {
    id,
    sourceAccountId: overrides.src ?? 'acc-alice',
    recipientAccountId: overrides.dst ?? 'acc-bruno',
    amountCents: overrides.amount ?? 10000,
    note: null,
    idempotencyKey: `key-${id}`,
    fingerprint: 'fp',
    now: T,
  });
  return id;
}

function status(db: Db, id: string): { status: string; failure: string | null } {
  return db.prepare('SELECT status, failure_code AS failure FROM transfers WHERE id=?').get(id) as {
    status: string;
    failure: string | null;
  };
}

describe('runSaga', () => {
  it('feliz até COMPLETED', async () => {
    const { db } = await freshDb();
    const id = mk(db);
    await expect(runSaga({ db, now: () => T, retry: fastRetry }, id)).resolves.toBe('COMPLETED');
    expect(status(db, id)).toEqual({ status: 'COMPLETED', failure: null });
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('saldo insuficiente → FAILED sem ledger', async () => {
    const { db } = await freshDb();
    const id = mk(db, { src: 'acc-carla', dst: 'acc-alice', amount: 1 });
    await expect(runSaga({ db, now: () => T, retry: fastRetry }, id)).resolves.toBe('FAILED');
    expect(status(db, id)).toEqual({ status: 'FAILED', failure: 'INSUFFICIENT_FUNDS' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries').get()).toEqual({ n: 0 });
  });

  it('hook FAIL → compensação completa, invariantes ok', async () => {
    const { db } = await freshDb();
    const id = mk(db, { amount: 7000 });
    await expect(
      runSaga({ db, now: () => T, retry: fastRetry, hooks: { beforeCredit: () => 'FAIL' } }, id),
    ).resolves.toBe('FAILED');
    expect(status(db, id)).toEqual({ status: 'FAILED', failure: 'CREDIT_FAILED' });
    expect((db.prepare('SELECT balance_cents AS b FROM accounts WHERE id=?').get('acc-alice') as { b: number }).b).toBe(100000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('BUSY 2× depois passa → COMPLETED', async () => {
    const { db } = await freshDb();
    const id = mk(db);
    let calls = 0;
    const flakyDebit: typeof debitStep = (d, t, n) => {
      calls += 1;
      if (calls <= 2) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
      return debitStep(d, t, n);
    };
    await expect(
      runSaga({ db, now: () => T, retry: fastRetry, steps: { debit: flakyDebit } }, id),
    ).resolves.toBe('COMPLETED');
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('sempre BUSY → RETRY_LATER, nunca FAILED, attempts gravados', async () => {
    const { db } = await freshDb();
    const id = mk(db);
    const alwaysBusy = (): never => {
      throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' });
    };
    await expect(
      runSaga(
        { db, now: () => T, retry: { ...fastRetry, attempts: 2 }, steps: { debit: alwaysBusy as unknown as typeof debitStep } },
        id,
      ),
    ).resolves.toBe('RETRY_LATER');
    const s = status(db, id);
    expect(['PENDING', 'PROCESSING']).toContain(s.status);
    const row = db.prepare('SELECT attempts AS a, last_error AS e FROM transfers WHERE id=?').get(id) as { a: number; e: string };
    expect(row.a).toBeGreaterThanOrEqual(1);
    expect(row.e.length).toBeGreaterThan(0);
  });

  it('retomada de DEBITED termina sem segundo DEBIT', async () => {
    const { db } = await freshDb();
    const id = mk(db, { amount: 4000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    await expect(runSaga({ db, now: () => T, retry: fastRetry }, id)).resolves.toBe('COMPLETED');
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=? AND type='DEBIT'").get(id)).toEqual({ n: 1 });
    expect((db.prepare('SELECT balance_cents AS b FROM accounts WHERE id=?').get('acc-alice') as { b: number }).b).toBe(96000);
  });

  it('retomada de COMPENSATING → FAILED/CREDIT_FAILED', async () => {
    const { db } = await freshDb();
    const id = mk(db, { amount: 4000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    db.prepare(`UPDATE transfers SET saga_step='COMPENSATING', status='PROCESSING', last_error='x' WHERE id=?`).run(id);
    await expect(runSaga({ db, now: () => T, retry: fastRetry }, id)).resolves.toBe('FAILED');
    expect(status(db, id)).toEqual({ status: 'FAILED', failure: 'CREDIT_FAILED' });
  });

  it('recuperação com nova conexão no mesmo arquivo → COMPLETED, 1 DEBIT + 1 CREDIT', async () => {
    const { db, file } = await freshDb();
    const id = mk(db, { amount: 2000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    closeAll();
    const db2 = openDatabase(file);
    dbs.push(db2);
    await expect(runSaga({ db: db2, now: () => T, retry: fastRetry }, id)).resolves.toBe('COMPLETED');
    expect(db2.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=?').all(id)).toEqual([{ n: 2 }]);
    expect(checkInvariants(db2, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('abort durante afterDebit não executa crédito', async () => {
    const { db } = await freshDb();
    const id = mk(db, { amount: 1000 });
    const ctl = new AbortController();
    await expect(
      runSaga(
        {
          db,
          now: () => T,
          retry: fastRetry,
          signal: ctl.signal,
          hooks: {
            afterDebit: async () => {
              ctl.abort();
            },
          },
        },
        id,
      ),
    ).resolves.toBe('RETRY_LATER');
    // Débito commitado (passo atômico), mas nenhum crédito.
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=?').get(id)).toEqual({ n: 1 });
    expect((db.prepare('SELECT saga_step AS s FROM transfers WHERE id=?').get(id) as { s: string }).s).toBe('DEBITED');
  });

  it('após COMPLETED, hooks falhando não compensam', async () => {
    const { db } = await freshDb();
    const id = mk(db, { amount: 1000 });
    await expect(runSaga({ db, now: () => T, retry: fastRetry }, id)).resolves.toBe('COMPLETED');
    await expect(
      runSaga({ db, now: () => T, retry: fastRetry, hooks: { beforeCredit: () => 'FAIL' } }, id),
    ).resolves.toBe('COMPLETED');
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=?').get(id)).toEqual({ n: 2 });
  });
});
