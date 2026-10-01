import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from './connection.js';
import { migrate } from './migrate.js';

let dirs: string[] = [];
let dbs: Db[] = [];

function freshDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'bank-schema-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 's.sqlite'));
  dbs.push(db);
  migrate(db);
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

function seedMin(db: Db): void {
  db.exec(`
    INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
      VALUES ('u1', 'Alice', 'alice@demo.local', 'h', '${T}', '${T}'),
             ('u2', 'Bruno', 'bruno@demo.local', 'h', '${T}', '${T}');
    INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at)
      VALUES ('a1', 'u1', 'BRL', 100000, '${T}'),
             ('a2', 'u2', 'BRL', 25000, '${T}');
  `);
}

function mkTransfer(db: Db, id = 't1'): void {
  db.prepare(
    `INSERT INTO transfers (id, source_account_id, recipient_account_id, amount_cents, note,
       status, failure_code, saga_step, in_transit_cents, attempts, last_error,
       idempotency_key, payload_fingerprint, created_at, updated_at)
     VALUES (?, 'a1', 'a2', 100, NULL, 'PENDING', NULL, 'CREATED', 0, 0, NULL, ?, 'fp', '${T}', '${T}')`,
  ).run(id, `key-${id}`);
}

function ledger(db: Db, transferId: string, type: 'DEBIT' | 'CREDIT' | 'COMPENSATION', amount: number): void {
  db.prepare(
    `INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at)
     VALUES (?, ?, ?, ?, ?, '${T}')`,
  ).run(`l-${transferId}-${type}`, transferId, type === 'DEBIT' || type === 'COMPENSATION' ? 'a1' : 'a2', type, amount);
}

describe('schema 001', () => {
  it('todas as tabelas existem após migrate', () => {
    const db = freshDb();
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const t of ['users', 'accounts', 'sessions', 'contacts', 'transfers', 'ledger_entries', 'jobs', 'test_faults', 'schema_migrations']) {
      expect(names).toContain(t);
    }
  });

  it('saldo negativo ou não inteiro falha', () => {
    const db = freshDb();
    seedMin(db);
    expect(() =>
      db.prepare(`INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at) VALUES ('a3','u1','BRL',-1,'${T}')`).run(),
    ).toThrowError();
    expect(() =>
      db.prepare(`INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at) VALUES ('a3','u1','BRL',10.5,'${T}')`).run(),
    ).toThrowError();
    expect(() =>
      db.prepare(`INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at) VALUES ('a3','u1','USD',10,'${T}')`).run(),
    ).toThrowError();
  });

  it('unicidades: email, conta por usuário, contato por dono/destinatário, idempotency por conta', () => {
    const db = freshDb();
    seedMin(db);
    expect(() =>
      db.prepare(`INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES ('u9','X','alice@demo.local','h','${T}','${T}')`).run(),
    ).toThrowError(/UNIQUE/i);
    expect(() =>
      db.prepare(`INSERT INTO accounts (id,user_id,currency,balance_cents,updated_at) VALUES ('a9','u1','BRL',0,'${T}')`).run(),
    ).toThrowError(/UNIQUE/i);
    db.prepare(`INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES ('c1','u1','a2','Bruno','${T}')`).run();
    expect(() =>
      db.prepare(`INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES ('c2','u1','a2','B2','${T}')`).run(),
    ).toThrowError(/UNIQUE/i);
    mkTransfer(db, 't1');
    db.prepare(
      `INSERT INTO transfers (id, source_account_id, recipient_account_id, amount_cents, note,
         status, failure_code, saga_step, in_transit_cents, attempts, last_error,
         idempotency_key, payload_fingerprint, created_at, updated_at)
       VALUES ('t2', 'a1', 'a2', 50, NULL, 'PENDING', NULL, 'CREATED', 0, 0, NULL, 'key-t1', 'fp2', '${T}', '${T}')`,
    );
    expect(() =>
      db
        .prepare(
          `INSERT INTO transfers (id, source_account_id, recipient_account_id, amount_cents, note,
             status, failure_code, saga_step, in_transit_cents, attempts, last_error,
             idempotency_key, payload_fingerprint, created_at, updated_at)
           VALUES ('t2', 'a1', 'a2', 50, NULL, 'PENDING', NULL, 'CREATED', 0, 0, NULL, 'key-t1', 'fp2', '${T}', '${T}')`,
        )
        .run(),
    ).toThrowError(/UNIQUE/i);
  });

  it('segundo DEBIT/CREDIT/COMPENSATION falha (UNIQUE transfer,type)', () => {
    const db = freshDb();
    seedMin(db);
    mkTransfer(db);
    ledger(db, 't1', 'DEBIT', -100);
    expect(() => ledger(db, 't1', 'DEBIT', -100)).toThrowError(/UNIQUE/i);
    ledger(db, 't1', 'CREDIT', 100);
    expect(() => ledger(db, 't1', 'CREDIT', 100)).toThrowError(/UNIQUE/i);
  });

  it('COMPENSATION após CREDIT e vice-versa falham', () => {
    const db = freshDb();
    seedMin(db);
    mkTransfer(db, 't1');
    mkTransfer(db, 't2');
    ledger(db, 't1', 'DEBIT', -100);
    ledger(db, 't1', 'CREDIT', 100);
    expect(() => ledger(db, 't1', 'COMPENSATION', 100)).toThrowError(/mutually exclusive/i);
    ledger(db, 't2', 'DEBIT', -100);
    ledger(db, 't2', 'COMPENSATION', 100);
    expect(() => ledger(db, 't2', 'CREDIT', 100)).toThrowError(/mutually exclusive/i);
  });

  it('CREDIT/COMPENSATION sem DEBIT falham; sinal errado falha', () => {
    const db = freshDb();
    seedMin(db);
    mkTransfer(db);
    expect(() => ledger(db, 't1', 'CREDIT', 100)).toThrowError(/prior DEBIT/i);
    expect(() => ledger(db, 't1', 'COMPENSATION', 100)).toThrowError(/prior DEBIT/i);
    expect(() =>
      db.prepare(`INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES ('lx','t1','a1','DEBIT',100,'${T}')`).run(),
    ).toThrowError();
  });

  it('UPDATE/DELETE no ledger falham (imutável)', () => {
    const db = freshDb();
    seedMin(db);
    mkTransfer(db);
    ledger(db, 't1', 'DEBIT', -100);
    expect(() => db.prepare(`UPDATE ledger_entries SET amount_cents=-50 WHERE transfer_id='t1'`).run()).toThrowError(/immutable/i);
    expect(() => db.prepare(`DELETE FROM ledger_entries WHERE transfer_id='t1'`).run()).toThrowError(/immutable/i);
  });

  it('FK inválida falha; transfer self/intervalo/status-falha incoerentes falham', () => {
    const db = freshDb();
    seedMin(db);
    expect(() =>
      db.prepare(`INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES ('cx','u1','nope','X','${T}')`).run(),
    ).toThrowError(/FOREIGN KEY/i);
    expect(() =>
      db.prepare(`INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at)
        VALUES ('ts','a1','a1',100,'PENDING',NULL,'CREATED',0,0,'k-ts','fp','${T}','${T}')`).run(),
    ).toThrowError();
    expect(() =>
      db.prepare(`INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at)
        VALUES ('t0','a1','a2',0,'PENDING',NULL,'CREATED',0,0,'k-t0','fp','${T}','${T}')`).run(),
    ).toThrowError();
    expect(() =>
      db.prepare(`INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at)
        VALUES ('tf','a1','a2',100,'FAILED',NULL,'FAILED',0,0,'k-tf','fp','${T}','${T}')`).run(),
    ).toThrowError();
  });
});
