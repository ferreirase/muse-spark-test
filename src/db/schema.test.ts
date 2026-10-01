import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

let dir: string;
let db: Database.Database;
const NOW = '2026-10-01T00:00:00.000Z';

const insertUser = (id: string, email: string) =>
  db.prepare('INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, 'Nome', email, 'scrypt$x', NOW, NOW);
const insertAccount = (id: string, userId: string, balance = 100) =>
  db.prepare('INSERT INTO accounts (id,user_id,balance_cents,updated_at) VALUES (?,?,?,?)').run(id, userId, balance, NOW);
const insertTransfer = (id: string, src: string, dst: string, over: Record<string, unknown> = {}) => {
  const t = {
    amount_cents: 100, note: null, status: 'PENDING', failure_code: null,
    saga_step: 'CREATED', in_transit_cents: 0, attempts: 0, last_error: null,
    idempotency_key: `key-${id}`, payload_fingerprint: 'fp',
    created_at: NOW, updated_at: NOW,
    source_account_id: src, recipient_account_id: dst, id, ...over,
  };
  db.prepare(`INSERT INTO transfers (${Object.keys(t).join(',')}) VALUES (${Object.keys(t).map(() => '?').join(',')})`)
    .run(...Object.values(t));
};
const insertLedger = (id: string, transferId: string, accountId: string, type: string, amount: number) =>
  db.prepare('INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, transferId, accountId, type, amount, NOW);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'muse-schema-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const expectFail = (fn: () => unknown, msg: RegExp) => {
  expect(fn).toThrow(msg);
};

describe('schema 001', () => {
  it('cria todas as tabelas de doc-1 §4', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['users', 'accounts', 'sessions', 'contacts', 'transfers', 'ledger_entries', 'jobs', 'test_faults', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('rejeita saldo negativo, não inteiro e currency != BRL', () => {
    insertUser('u1', 'a@x.co');
    expectFail(() => insertAccount('acc1', 'u1', -1), /balance_cents|CHECK/);
    expectFail(() => db.prepare('INSERT INTO accounts (id,user_id,balance_cents,updated_at) VALUES (?,?,?,?)').run('acc2', 'u1', 10.5, NOW), /REAL value in INTEGER column|cannot store/i);
    expectFail(() => db.prepare('INSERT INTO accounts (id,user_id,currency,balance_cents,updated_at) VALUES (?,?,?,?,?)').run('acc3', 'u1', 'USD', 10, NOW), /currency/);
  });

  it('e-mail duplicado, segunda conta por usuário e FK inválida falham', () => {
    insertUser('u1', 'a@x.co');
    expectFail(() => insertUser('u2', 'a@x.co'), /UNIQUE/);
    insertAccount('acc1', 'u1');
    expectFail(() => insertAccount('acc1b', 'u1'), /UNIQUE/);
    expectFail(() => insertAccount('acc-fantasma', 'ninguem'), /FOREIGN KEY/);
  });

  it('contato duplicado por dono/destinatário falha', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    db.prepare('INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?)').run('c1', 'u1', 'acc2', 'B', NOW);
    expectFail(() =>
      db.prepare('INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?)').run('c2', 'u1', 'acc2', 'Outro', NOW), /UNIQUE/);
  });

  it('amount fora da faixa, self transfer, enums e coerência status/failure falham', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { amount_cents: 0 }), /amount_cents/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { amount_cents: 100000001 }), /amount_cents/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc1'), /source_account_id/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { status: 'XPTO' }), /status/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { saga_step: 'MEIO' }), /saga_step/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { status: 'FAILED' }), /status.*failure|failure.*status|CHECK/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { status: 'PENDING', failure_code: 'CREDIT_FAILED' }), /CHECK/);
    expectFail(() => insertTransfer('t0', 'acc1', 'acc2', { in_transit_cents: -1 }), /in_transit/);
  });

  it('idempotency key única por conta remetente', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    insertTransfer('t1', 'acc1', 'acc2', { idempotency_key: 'mesma-key' });
    expectFail(() => insertTransfer('t2', 'acc1', 'acc2', { idempotency_key: 'mesma-key' }), /UNIQUE/);
    insertTransfer('t3', 'acc2', 'acc1', { idempotency_key: 'mesma-key' }); // outra conta: ok
  });

  it('ledger: um passo por tipo, sinais e triggers de exclusividade/pré-requisito', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    insertTransfer('t1', 'acc1', 'acc2');

    expectFail(() => insertLedger('l0', 't1', 'acc1', 'DEBIT', 100), /amount_cents/); // DEBIT deve ser negativo
    expectFail(() => insertLedger('l0', 't1', 'acc2', 'CREDIT', 100), /exige DEBIT/); // CREDIT sem DEBIT
    insertLedger('l1', 't1', 'acc1', 'DEBIT', -100);
    expectFail(() => insertLedger('l1b', 't1', 'acc1', 'DEBIT', -100), /UNIQUE/); // segundo DEBIT
    insertLedger('l2', 't1', 'acc2', 'CREDIT', 100);
    expectFail(() => insertLedger('l3', 't1', 'acc1', 'COMPENSATION', 100), /mutuamente exclusivos/);
    expectFail(() => insertLedger('l4', 't1', 'acc2', 'CREDIT', 100), /UNIQUE/); // segundo CREDIT
  });

  it('COMPENSATION sem DEBIT falha; fluxo de compensação válido passa', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    insertTransfer('t1', 'acc1', 'acc2');
    expectFail(() => insertLedger('l1', 't1', 'acc1', 'COMPENSATION', 100), /exige DEBIT/);
    insertLedger('l2', 't1', 'acc1', 'DEBIT', -100);
    insertLedger('l3', 't1', 'acc1', 'COMPENSATION', 100);
    expectFail(() => insertLedger('l4', 't1', 'acc2', 'CREDIT', 100), /mutuamente exclusivos/);
  });

  it('ledger é imutável (UPDATE/DELETE abortam)', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    insertTransfer('t1', 'acc1', 'acc2');
    insertLedger('l1', 't1', 'acc1', 'DEBIT', -100);
    expectFail(() => db.prepare("UPDATE ledger_entries SET amount_cents = -999 WHERE id='l1'").run(), /imutaveis/);
    expectFail(() => db.prepare("DELETE FROM ledger_entries WHERE id='l1'").run(), /imutaveis/);
  });

  it('jobs exige transfer única e status do enum', () => {
    insertUser('u1', 'a@x.co');
    insertUser('u2', 'b@x.co');
    insertAccount('acc1', 'u1');
    insertAccount('acc2', 'u2');
    insertTransfer('t1', 'acc1', 'acc2');
    db.prepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('j1', 't1', 'PENDING', NOW, NOW, NOW);
    expectFail(() => db.prepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('j2', 't1', 'PENDING', NOW, NOW, NOW), /UNIQUE/);
    expectFail(() => db.prepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('j3', 't1', 'RUNNING', NOW, NOW, NOW), /status/);
  });
});
