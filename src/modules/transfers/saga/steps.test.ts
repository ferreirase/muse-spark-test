import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed, INITIAL_TOTAL_CENTS, SEED_CREATED_AT } from '../../../db/seed.js';
import { debitStep, creditStep, markCompensating, compensateStep, CreditFailedError } from './steps.js';
import { checkInvariants } from './invariants.js';

let dir: string;
let db: Database.Database;
const NOW = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-saga-'));
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
const transfer = (id: string) =>
  db.prepare('SELECT * FROM transfers WHERE id=?').get(id) as Record<string, unknown>;
const job = (id: string) => db.prepare('SELECT * FROM jobs WHERE transfer_id=?').get(id) as Record<string, unknown>;
const ledger = (id: string) =>
  (db.prepare('SELECT type, amount_cents FROM ledger_entries WHERE transfer_id=? ORDER BY type').all(id) as { type: string; amount_cents: number }[]);

const expectHealthyInvariants = () => {
  const inv = checkInvariants(db);
  expect(inv.negativeBalances).toBe(0);
  expect(inv.transitInTerminal).toBe(0);
  expect(inv.creditAndCompensation).toBe(0);
  expect(inv.totalCents).toBe(INITIAL_TOTAL_CENTS);
};

describe('saga steps', () => {
  it('fluxo feliz: debit → credit completa com saldos e ledger corretos', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 10000);
    expect(debitStep(db, 't1', NOW)).toBe('APPLIED');
    expect(transfer('t1')).toMatchObject({ saga_step: 'DEBITED', status: 'PROCESSING', in_transit_cents: 10000 });
    expect(job('t1')).toMatchObject({ status: 'PENDING' });
    expect(balance('acc-alice')).toBe(90000);
    expect(balance('acc-bruno')).toBe(25000); // crédito ainda não aplicado
    expect(ledger('t1')).toEqual([{ type: 'DEBIT', amount_cents: -10000 }]);

    expect(creditStep(db, 't1', NOW)).toBe('APPLIED');
    expect(transfer('t1')).toMatchObject({ saga_step: 'COMPLETED', status: 'COMPLETED', in_transit_cents: 0, failure_code: null });
    expect(job('t1')).toMatchObject({ status: 'DONE' });
    expect(balance('acc-alice')).toBe(90000);
    expect(balance('acc-bruno')).toBe(35000);
    expect(ledger('t1')).toEqual([
      { type: 'CREDIT', amount_cents: 10000 },
      { type: 'DEBIT', amount_cents: -10000 },
    ]);
    expectHealthyInvariants();
  });

  it('saldo insuficiente: FAILED/INSUFFICIENT_FUNDS sem ledger e sem movimentação', () => {
    makeTransfer('t1', 'acc-carla', 'acc-alice', 1);
    expect(debitStep(db, 't1', NOW)).toBe('INSUFFICIENT_FUNDS');
    expect(transfer('t1')).toMatchObject({
      saga_step: 'FAILED', status: 'FAILED', failure_code: 'INSUFFICIENT_FUNDS', in_transit_cents: 0,
    });
    expect(job('t1')).toMatchObject({ status: 'DONE' });
    expect(ledger('t1')).toEqual([]);
    expect(balance('acc-alice')).toBe(100000);
    expect(balance('acc-carla')).toBe(0);
    expectHealthyInvariants();
  });

  it('saldo exato debita com sucesso (Bruno 25000)', () => {
    makeTransfer('t1', 'acc-bruno', 'acc-alice', 25000);
    expect(debitStep(db, 't1', NOW)).toBe('APPLIED');
    expect(balance('acc-bruno')).toBe(0);
    expect(creditStep(db, 't1', NOW)).toBe('APPLIED');
    expectHealthyInvariants();
  });

  it('reexecução de passos é ALREADY_APPLIED sem efeito', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 1000);
    expect(debitStep(db, 't1', NOW)).toBe('APPLIED');
    expect(debitStep(db, 't1', NOW)).toBe('ALREADY_APPLIED');
    expect(balance('acc-alice')).toBe(99000);
    expect(ledger('t1').length).toBe(1);

    expect(creditStep(db, 't1', NOW)).toBe('APPLIED');
    expect(creditStep(db, 't1', NOW)).toBe('ALREADY_APPLIED');
    expect(balance('acc-bruno')).toBe(26000);
    expect(ledger('t1').length).toBe(2);

    expect(compensateStep(db, 't1', NOW)).toBe('ALREADY_APPLIED');
    expect(transfer('t1')).toMatchObject({ status: 'COMPLETED' });
    expectHealthyInvariants();
  });

  it('crédito em transferência sem débito (CREATED) é no-op', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 500);
    expect(creditStep(db, 't1', NOW)).toBe('ALREADY_APPLIED');
    expect(balance('acc-bruno')).toBe(25000);
    expect(transfer('t1')).toMatchObject({ saga_step: 'CREATED', status: 'PENDING' });
    expect(ledger('t1')).toEqual([]);
    expectHealthyInvariants();
  });

  it('compensação restaura o débito e termina FAILED/CREDIT_FAILED', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 700);
    debitStep(db, 't1', NOW);
    expect(markCompensating(db, 't1', 'fault FAIL_CREDIT_ONCE', NOW)).toBe('APPLIED');
    expect(transfer('t1')).toMatchObject({ saga_step: 'COMPENSATING', status: 'PROCESSING', in_transit_cents: 700 });
    expect(job('t1')).toMatchObject({ status: 'PENDING' });

    expect(compensateStep(db, 't1', NOW)).toBe('APPLIED');
    expect(transfer('t1')).toMatchObject({
      saga_step: 'FAILED', status: 'FAILED', failure_code: 'CREDIT_FAILED', in_transit_cents: 0,
    });
    expect(job('t1')).toMatchObject({ status: 'DONE' });
    expect(balance('acc-alice')).toBe(100000);
    expect(balance('acc-bruno')).toBe(25000);
    expect(ledger('t1')).toEqual([
      { type: 'COMPENSATION', amount_cents: 700 },
      { type: 'DEBIT', amount_cents: -700 },
    ]);
    expectHealthyInvariants();
  });

  it('compensação soma de volta; nunca restaura snapshot (T2 legítima preservada)', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    makeTransfer('t2', 'acc-alice', 'acc-carla', 50);
    debitStep(db, 't1', NOW);
    debitStep(db, 't2', NOW);
    creditStep(db, 't2', NOW); // T2 completa: alice 100000-100-50 = 99850

    markCompensating(db, 't1', 'credito falhou', NOW);
    compensateStep(db, 't1', NOW); // +100 → 99950 = inicial − T2

    expect(balance('acc-alice')).toBe(99950);
    expect(balance('acc-carla')).toBe(50);
    expect(transfer('t1')).toMatchObject({ status: 'FAILED', failure_code: 'CREDIT_FAILED' });
    expect(transfer('t2')).toMatchObject({ status: 'COMPLETED' });
    expectHealthyInvariants();
  });

  it('disputa por saldo: só uma de duas transferências concorrentes debita', () => {
    makeTransfer('t1', 'acc-bruno', 'acc-alice', 20000);
    makeTransfer('t2', 'acc-bruno', 'acc-alice', 20000);
    const r1 = debitStep(db, 't1', NOW);
    const r2 = debitStep(db, 't2', NOW);
    const results = [r1, r2].sort();
    expect(results).toEqual(['APPLIED', 'INSUFFICIENT_FUNDS']);
    const brunoFinal = balance('acc-bruno');
    expect(brunoFinal).toBe(5000); // um débito de 20000
    creditStep(db, r1 === 'APPLIED' ? 't1' : 't2', NOW);
    expectHealthyInvariants();
  });

  it('markCompensating em estado não-DEBITED é no-op', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    expect(markCompensating(db, 't1', 'x', NOW)).toBe('ALREADY_APPLIED');
    expect(transfer('t1')).toMatchObject({ saga_step: 'CREATED', status: 'PENDING' });
    expect(compensateStep(db, 't1', NOW)).toBe('ALREADY_APPLIED');
    expect(ledger('t1')).toEqual([]);
    expectHealthyInvariants();
  });

  it('CreditFailedError quando destinatário não existe no crédito (rollback preserva estado)', () => {
    makeTransfer('t1', 'acc-alice', 'acc-bruno', 100);
    debitStep(db, 't1', NOW);
    // fixture: destinatário some entre débito e crédito (FK off só no setup)
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM accounts WHERE id=?').run('acc-bruno');
    db.pragma('foreign_keys = ON');

    expect(() => creditStep(db, 't1', NOW)).toThrow(CreditFailedError);
    // o rollback da transação preserva DEBITED sem crédito aplicado
    expect(transfer('t1')).toMatchObject({ saga_step: 'DEBITED', status: 'PROCESSING' });
    expect(ledger('t1')).toEqual([{ type: 'DEBIT', amount_cents: -100 }]);
  });
});
