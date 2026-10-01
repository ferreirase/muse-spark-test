import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed, SEED_CREATED_AT, INITIAL_TOTAL_CENTS } from '../../../db/seed.js';
import { debitStep, markCompensating } from './steps.js';
import { runSaga, type SagaHooks } from './orchestrator.js';
import { checkInvariants } from './invariants.js';

let dir: string;
let db: Database.Database;
const NOW = () => new Date('2026-10-01T12:00:00.000Z');
const noSleep = async () => {};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-orch-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeTransfer(id: string, src: string, dst: string, amount: number): void {
  db.prepare(
    "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(id, src, dst, amount, null, 'PENDING', null, 'CREATED', 0, 0, `key-${id}`, 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
  db.prepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(
    `job-${id}`, id, 'PENDING', SEED_CREATED_AT, SEED_CREATED_AT, SEED_CREATED_AT,
  );
}

const balance = (id: string) => (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(id) as { b: number }).b;
const transfer = (id: string) => db.prepare('SELECT * FROM transfers WHERE id=?').get(id) as Record<string, unknown>;
const ledgerCount = (id: string, type?: string) =>
  (db.prepare(type ? 'SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id=? AND type=?' : 'SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id=?').get(...(type ? [id, type] : [id])) as { c: number }).c;

const baseDeps = (over: Partial<Parameters<typeof runSaga>[0]> = {}) => ({
  db,
  clock: NOW,
  retry: { sleep: noSleep, random: () => 0 },
  ...over,
});

describe('runSaga', () => {
  it('fluxo feliz até COMPLETED com saldos e ledger corretos', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 10000);
    const out = await runSaga(baseDeps(), 't1');
    expect(out).toBe('COMPLETED');
    expect(transfer('t1')).toMatchObject({ status: 'COMPLETED', saga_step: 'COMPLETED', in_transit_cents: 0 });
    expect(balance('acc-alice')).toBe(90000);
    expect(balance('acc-bruno')).toBe(35000);
    expect(ledgerCount('t1', 'DEBIT')).toBe(1);
    expect(ledgerCount('t1', 'CREDIT')).toBe(1);
    expect(checkInvariants(db).totalCents).toBe(INITIAL_TOTAL_CENTS);
  });

  it('saldo insuficiente termina FAILED sem ledger', async () => {
    makeTransfer('t1', 'acc-carla', 'acc-alice', 1);
    const out = await runSaga(baseDeps(), 't1');
    expect(out).toBe('FAILED');
    expect(transfer('t1')).toMatchObject({ status: 'FAILED', failure_code: 'INSUFFICIENT_FUNDS' });
    expect(ledgerCount('t1')).toBe(0);
  });

  it('hook beforeCredit FAIL → compensação completa e saldo restaurado', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 700);
    const hooks: SagaHooks = { beforeCredit: async () => 'FAIL' as const };
    const out = await runSaga(baseDeps({ hooks }), 't1');
    expect(out).toBe('FAILED');
    expect(transfer('t1')).toMatchObject({ status: 'FAILED', failure_code: 'CREDIT_FAILED' });
    expect(balance('acc-alice')).toBe(100000);
    expect(ledgerCount('t1', 'DEBIT')).toBe(1);
    expect(ledgerCount('t1', 'COMPENSATION')).toBe(1);
    expect(ledgerCount('t1', 'CREDIT')).toBe(0);
    expect(checkInvariants(db).totalCents).toBe(INITIAL_TOTAL_CENTS);
  });

  it('retoma a partir de DEBITED persistido sem segundo débito', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 500);
    debitStep(db, 't1', NOW());
    const out = await runSaga(baseDeps(), 't1');
    expect(out).toBe('COMPLETED');
    expect(ledgerCount('t1', 'DEBIT')).toBe(1);
    expect(ledgerCount('t1', 'CREDIT')).toBe(1);
    expect(balance('acc-alice')).toBe(99500);
  });

  it('retoma a partir de COMPENSATING → FAILED/CREDIT_FAILED', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 300);
    debitStep(db, 't1', NOW());
    markCompensating(db, 't1', 'crash antes do crédito', NOW());
    const out = await runSaga(baseDeps(), 't1');
    expect(out).toBe('FAILED');
    expect(transfer('t1')).toMatchObject({ status: 'FAILED', failure_code: 'CREDIT_FAILED' });
    expect(balance('acc-alice')).toBe(100000);
  });

  it('BUSY transitório 2× e depois passa → COMPLETED', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    const flaky = flakyDb(db, 2);
    const out = await runSaga(baseDeps({ db: flaky as unknown as Database.Database }), 't1');
    expect(out).toBe('COMPLETED');
    expect(ledgerCount('t1', 'CREDIT')).toBe(1);
  });

  it('BUSY eterno → RETRY_LATER sem FAILED, com attempts e last_error', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    const flaky = flakyDb(db, 99);
    const out = await runSaga(baseDeps({ db: flaky as unknown as Database.Database }), 't1');
    expect(out).toBe('RETRY_LATER');
    const t = transfer('t1');
    expect(t.status).not.toBe('FAILED');
    expect(t.attempts).toBeGreaterThan(0);
    expect(t.last_error).toBeTruthy();
    expect(checkInvariants(db).totalCents).toBe(INITIAL_TOTAL_CENTS);
  });

  it('recuperação com reinício de conexão: close → reopen → runSaga termina sem duplicar', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 1000);
    debitStep(db, 't1', NOW());
    const file = join(dir, 's.sqlite');
    db.close();
    const db2 = openDatabase(file);
    const out = await runSaga({ db: db2, clock: NOW, retry: { sleep: noSleep, random: () => 0 } }, 't1');
    expect(out).toBe('COMPLETED');
    const one = (sql: string, ...a: unknown[]) => (db2.prepare(sql).get(...a) as { c: number }).c;
    expect(one('SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id=? AND type=?', 't1', 'DEBIT')).toBe(1);
    expect(one('SELECT COUNT(*) c FROM ledger_entries WHERE transfer_id=? AND type=?', 't1', 'CREDIT')).toBe(1);
    expect((db2.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get('acc-alice') as { b: number }).b).toBe(99000);
    db2.close();
    // reabre para o afterEach não fechar duas vezes
    db = openDatabase(file);
  });

  it('abort durante pausa (afterDebit) não executa crédito', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    const controller = new AbortController();
    const hooks: SagaHooks = {
      afterDebit: async () => {
        controller.abort();
      },
    };
    const out = await runSaga(baseDeps({ hooks, signal: controller.signal }), 't1');
    expect(out).toBe('RETRY_LATER');
    expect(transfer('t1')).toMatchObject({ saga_step: 'DEBITED', status: 'PROCESSING' });
    expect(ledgerCount('t1', 'CREDIT')).toBe(0);
    expect(checkInvariants(db).totalCents).toBe(INITIAL_TOTAL_CENTS);
  });

  it('estado terminal persistido retorna direto e garante job DONE', async () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    await runSaga(baseDeps(), 't1');
    db.prepare("UPDATE jobs SET status='PENDING' WHERE transfer_id=?").run('t1'); // simula inconsistência
    const out = await runSaga(baseDeps(), 't1');
    expect(out).toBe('COMPLETED');
    const job = db.prepare('SELECT status FROM jobs WHERE transfer_id=?').get('t1') as { status: string };
    expect(job.status).toBe('DONE');
  });
});

/** Proxy que injeta SQLITE_BUSY nas N primeiras transações executadas. */
function flakyDb(real: Database.Database, times: number): Database.Database {
  let left = times;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (fn: Parameters<Database.Database['transaction']>[0]) => {
          const tx = target.transaction(fn);
          const wrapped = (...args: unknown[]) => {
            if (left > 0) { left--; throw busy(); }
            return (tx as (...a: unknown[]) => unknown)(...args);
          };
          (wrapped as { immediate?: (...a: unknown[]) => unknown }).immediate = (...args: unknown[]) => {
            if (left > 0) { left--; throw busy(); }
            return (tx as unknown as { immediate: (...a: unknown[]) => unknown }).immediate(...args);
          };
          return wrapped;
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as Database.Database;
}

const busy = () => Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
