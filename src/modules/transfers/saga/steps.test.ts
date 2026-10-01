import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { INITIAL_TOTAL_CENTS, seed } from '../../../db/seed.js';
import { checkInvariants } from './invariants.js';
import {
  CreditFailedError,
  compensateStep,
  creditStep,
  debitStep,
  insertCreatedTransfer,
  markCompensating,
} from './steps.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-steps-'));
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
let seq = 0;

function mk(db: Db, overrides: Partial<{ src: string; dst: string; amount: number; id: string }> = {}): string {
  seq += 1;
  const id = overrides.id ?? `t${seq}`;
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

function balance(db: Db, id: string): number {
  return (db.prepare('SELECT balance_cents AS b FROM accounts WHERE id=?').get(id) as { b: number }).b;
}

function transfer(db: Db, id: string): { status: string; failure: string | null; step: string; transit: number } {
  return db.prepare(
    `SELECT status, failure_code AS failure, saga_step AS step, in_transit_cents AS transit FROM transfers WHERE id=?`,
  ).get(id) as { status: string; failure: string | null; step: string; transit: number };
}

describe('saga steps', () => {
  it('feliz: debit → credit; Alice 90000 / Bruno 35000; COMPLETED', async () => {
    const db = await freshDb();
    const id = mk(db, { amount: 10000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    expect(transfer(db, id)).toMatchObject({ status: 'PROCESSING', step: 'DEBITED', transit: 10000 });
    expect(creditStep(db, id, T)).toBe('APPLIED');
    expect(transfer(db, id)).toMatchObject({ status: 'COMPLETED', step: 'COMPLETED', transit: 0 });
    expect(balance(db, 'acc-alice')).toBe(90000);
    expect(balance(db, 'acc-bruno')).toBe(35000);
    expect(db.prepare('SELECT type FROM ledger_entries WHERE transfer_id=? ORDER BY type').all(id)).toEqual([
      { type: 'CREDIT' },
      { type: 'DEBIT' },
    ]);
    expect(db.prepare(`SELECT status FROM jobs WHERE transfer_id=?`).get(id)).toEqual({ status: 'DONE' });
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('Carla (saldo 0) envia 1 → FAILED/INSUFFICIENT_FUNDS sem ledger', async () => {
    const db = await freshDb();
    const id = mk(db, { src: 'acc-carla', dst: 'acc-alice', amount: 1 });
    expect(debitStep(db, id, T)).toBe('INSUFFICIENT_FUNDS');
    expect(transfer(db, id)).toMatchObject({ status: 'FAILED', failure: 'INSUFFICIENT_FUNDS', transit: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=?').get(id)).toEqual({ n: 0 });
    expect(balance(db, 'acc-carla')).toBe(0);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('saldo exato (Bruno envia 25000) → sucesso, saldo 0', async () => {
    const db = await freshDb();
    const id = mk(db, { src: 'acc-bruno', dst: 'acc-carla', amount: 25000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    expect(creditStep(db, id, T)).toBe('APPLIED');
    expect(balance(db, 'acc-bruno')).toBe(0);
    expect(balance(db, 'acc-carla')).toBe(25000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('reexecução é no-op: debit/credit/compensate 2×', async () => {
    const db = await freshDb();
    const id = mk(db, { amount: 5000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    expect(debitStep(db, id, T)).toBe('ALREADY_APPLIED');
    expect(creditStep(db, id, T)).toBe('APPLIED');
    expect(creditStep(db, id, T)).toBe('ALREADY_APPLIED');
    expect(balance(db, 'acc-alice')).toBe(95000);
    expect(markCompensating(db, id, 'x', T)).toBe('ALREADY_APPLIED');
    expect(compensateStep(db, id, T)).toBe('ALREADY_APPLIED');
    expect(balance(db, 'acc-alice')).toBe(95000);
    // credit em CREATED nunca credita
    const id2 = mk(db, { amount: 100 });
    expect(creditStep(db, id2, T)).toBe('ALREADY_APPLIED');
    expect(balance(db, 'acc-bruno')).toBe(30000);
  });

  it('compensação: saldo restaurado, FAILED/CREDIT_FAILED', async () => {
    const db = await freshDb();
    const id = mk(db, { amount: 7000 });
    expect(debitStep(db, id, T)).toBe('APPLIED');
    expect(balance(db, 'acc-alice')).toBe(93000);
    expect(markCompensating(db, id, 'credit boom', T)).toBe('APPLIED');
    expect(compensateStep(db, id, T)).toBe('APPLIED');
    expect(compensateStep(db, id, T)).toBe('ALREADY_APPLIED');
    expect(transfer(db, id)).toMatchObject({ status: 'FAILED', failure: 'CREDIT_FAILED', transit: 0 });
    expect(balance(db, 'acc-alice')).toBe(100000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('compensação soma de volta (não snapshot): preserva operação concorrente', async () => {
    const db = await freshDb();
    const t1 = mk(db, { amount: 10000 });
    const t2 = mk(db, { amount: 3000 });
    expect(debitStep(db, t1, T)).toBe('APPLIED'); // Alice 90000
    expect(debitStep(db, t2, T)).toBe('APPLIED'); // Alice 87000
    expect(creditStep(db, t2, T)).toBe('APPLIED'); // T2 completa
    expect(markCompensating(db, t1, 'x', T)).toBe('APPLIED');
    expect(compensateStep(db, t1, T)).toBe('APPLIED');
    // Final = inicial − T2 (100000 − 3000)
    expect(balance(db, 'acc-alice')).toBe(97000);
    expect(balance(db, 'acc-bruno')).toBe(28000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('disputa por saldo: duas de 20000 de Bruno (25000) → 1 ok + 1 INSUFFICIENT_FUNDS', async () => {
    const db = await freshDb();
    const t1 = mk(db, { src: 'acc-bruno', dst: 'acc-carla', amount: 20000 });
    const t2 = mk(db, { src: 'acc-bruno', dst: 'acc-carla', amount: 20000 });
    expect(debitStep(db, t1, T)).toBe('APPLIED');
    expect(debitStep(db, t2, T)).toBe('INSUFFICIENT_FUNDS');
    expect(creditStep(db, t1, T)).toBe('APPLIED');
    expect(balance(db, 'acc-bruno')).toBe(5000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('credit sem DEBIT registrado → CreditFailedError e nada creditado', async () => {
    const db = await freshDb();
    const id2 = mk(db, { amount: 100 });
    // Força estado DEBITED sem ledger: atualiza direto (teste da guarda interna).
    db.prepare(`UPDATE transfers SET saga_step='DEBITED' WHERE id=?`).run(id2);
    let thrown: unknown = null;
    try {
      creditStep(db, id2, T);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CreditFailedError);
    // Rollback total: estado e saldos intactos.
    expect(balance(db, 'acc-alice')).toBe(100000);
    expect(balance(db, 'acc-bruno')).toBe(25000);
    expect(db.prepare('SELECT saga_step AS s FROM transfers WHERE id=?').get(id2)).toEqual({ s: 'DEBITED' });
  });
});
