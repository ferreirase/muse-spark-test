import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { seed, resetDatabase, INITIAL_TOTAL_CENTS, SEED_BALANCES, SEED_CREATED_AT } from './seed.js';
import { verifyPassword } from '../modules/auth/password.js';

let dir: string;
let db: Database.Database;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-seed-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const one = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as Record<string, unknown> | undefined;

describe('seed', () => {
  it('popula banco vazio com os dados exatos do contrato', async () => {
    await seed(db);
    const users = db.prepare('SELECT id,email FROM users ORDER BY id').all() as { id: string; email: string }[];
    expect(users).toEqual([
      { id: 'user-alice', email: 'alice@demo.local' },
      { id: 'user-bruno', email: 'bruno@demo.local' },
      { id: 'user-carla', email: 'carla@demo.local' },
    ]);
    for (const [acc, balance] of Object.entries(SEED_BALANCES)) {
      const row = one('SELECT user_id, balance_cents, currency FROM accounts WHERE id=?', acc);
      expect(row).toBeTruthy();
      expect(row!.balance_cents).toBe(balance);
      expect(row!.currency).toBe('BRL');
    }
    const total = (one('SELECT SUM(balance_cents) s FROM accounts')!.s as number);
    expect(total).toBe(INITIAL_TOTAL_CENTS);
    const contact = one('SELECT id, owner_user_id, recipient_account_id, nickname FROM contacts');
    expect(contact).toEqual({
      id: 'contact-bruno', owner_user_id: 'user-alice', recipient_account_id: 'acc-bruno', nickname: 'Bruno',
    });
    expect(db.prepare('SELECT COUNT(*) c FROM transfers').get()).toEqual({ c: 0 });
  });

  it('senha de todas as contas verifica Demo123!', async () => {
    await seed(db);
    const hashes = db.prepare('SELECT password_hash FROM users ORDER BY id').all() as { password_hash: string }[];
    expect(hashes.length).toBe(3);
    for (const h of hashes) {
      await expect(verifyPassword('Demo123!', h.password_hash)).resolves.toBe(true);
      await expect(verifyPassword('Errada123!', h.password_hash)).resolves.toBe(false);
    }
  });

  it('seed 2× não duplica nem falha', async () => {
    await seed(db);
    await seed(db);
    expect(db.prepare('SELECT COUNT(*) c FROM users').get()).toEqual({ c: 3 });
    expect(db.prepare('SELECT COUNT(*) c FROM accounts').get()).toEqual({ c: 3 });
    expect(db.prepare('SELECT COUNT(*) c FROM contacts').get()).toEqual({ c: 1 });
  });

  it('seed não altera saldos nem apaga operações existentes', async () => {
    await seed(db);
    db.prepare('UPDATE accounts SET balance_cents=99999 WHERE id=?').run('acc-alice');
    db.prepare(
      "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run('t-1', 'acc-alice', 'acc-bruno', 1, null, 'PENDING', null, 'CREATED', 0, 0, 'k-1', 'fp', SEED_CREATED_AT, SEED_CREATED_AT);

    await seed(db);
    expect(one('SELECT balance_cents FROM accounts WHERE id=?', 'acc-alice')!.balance_cents).toBe(99999);
    expect(one('SELECT id FROM transfers WHERE id=?', 't-1')).toBeTruthy();
  });
});

describe('resetDatabase', () => {
  it('limpa sessões, contatos, transferências, ledger, jobs, faults e restaura o seed', async () => {
    await seed(db);
    db.prepare('UPDATE accounts SET balance_cents=5 WHERE id=?').run('acc-alice');
    db.prepare('INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?,?)').run('s1', 'tok-h', 'user-alice', SEED_CREATED_AT, '2026-10-02T00:00:00.000Z');
    db.prepare('INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?)').run('c-x', 'user-bruno', 'acc-alice', 'A', SEED_CREATED_AT);
    db.prepare(
      "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run('t-1', 'acc-alice', 'acc-bruno', 1, null, 'PROCESSING', null, 'DEBITED', 1, 0, 'k-1', 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
    db.prepare('INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES (?,?,?,?,?,?)').run('l-1', 't-1', 'acc-alice', 'DEBIT', -1, SEED_CREATED_AT);
    db.prepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('j-1', 't-1', 'PENDING', SEED_CREATED_AT, SEED_CREATED_AT, SEED_CREATED_AT);
    db.prepare('INSERT INTO test_faults (id,source_account_id,idempotency_key,mode,armed_at) VALUES (?,?,?,?,?)').run('f-1', 'acc-alice', 'k-1', 'PAUSE_AFTER_DEBIT', SEED_CREATED_AT);

    await resetDatabase(db);

    expect(db.prepare('SELECT COUNT(*) c FROM sessions').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM transfers').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM ledger_entries').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM jobs').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM test_faults').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM contacts').get()).toEqual({ c: 1 }); // só o do seed
    expect(one('SELECT balance_cents FROM accounts WHERE id=?', 'acc-alice')!.balance_cents).toBe(SEED_BALANCES['acc-alice']);
    expect(one('SELECT SUM(balance_cents) s FROM accounts')!.s).toBe(INITIAL_TOTAL_CENTS);
  });

  it('trigger de imutabilidade do ledger continua ativo após reset', async () => {
    await seed(db);
    await resetDatabase(db);
    db.prepare(
      "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run('t-9', 'acc-alice', 'acc-bruno', 5, null, 'PROCESSING', null, 'DEBITED', 0, 0, 'k-9', 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
    db.prepare('INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES (?,?,?,?,?,?)').run('l-9', 't-9', 'acc-alice', 'DEBIT', -5, SEED_CREATED_AT);
    expect(() => db.prepare('DELETE FROM ledger_entries').run()).toThrow(/imutaveis/);
  });

  it('schema_migrations preserva versão após reset (migrate idempotente)', async () => {
    await seed(db);
    await resetDatabase(db);
    expect(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get()).toEqual({ c: 1 });
    expect(() => migrate(db)).not.toThrow();
  });
});
