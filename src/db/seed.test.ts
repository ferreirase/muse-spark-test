import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from './connection.js';
import { migrate } from './migrate.js';
import { verifyPassword } from '../modules/auth/password.js';
import { INITIAL_TOTAL_CENTS, SEED_PASSWORD, resetDatabase, seed, totalBalances } from './seed.js';

let dirs: string[] = [];
let dbs: Db[] = [];

function freshDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'bank-seed-'));
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

describe('seed/reset', () => {
  it('seed em banco vazio cria dados exatos do contrato, soma 125000', async () => {
    const db = freshDb();
    await seed(db);
    const users = db.prepare('SELECT id,name,email FROM users ORDER BY id').all();
    expect(users).toEqual([
      { id: 'user-alice', name: 'Alice Demo', email: 'alice@demo.local' },
      { id: 'user-bruno', name: 'Bruno Demo', email: 'bruno@demo.local' },
      { id: 'user-carla', name: 'Carla Demo', email: 'carla@demo.local' },
    ]);
    const accs = db.prepare('SELECT id,balance_cents AS b FROM accounts ORDER BY id').all();
    expect(accs).toEqual([
      { id: 'acc-alice', b: 100000 },
      { id: 'acc-bruno', b: 25000 },
      { id: 'acc-carla', b: 0 },
    ]);
    expect(totalBalances(db)).toBe(INITIAL_TOTAL_CENTS);
    const contacts = db.prepare('SELECT id,nickname,recipient_account_id AS r FROM contacts').all();
    expect(contacts).toEqual([{ id: 'contact-bruno', nickname: 'Bruno', r: 'acc-bruno' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 0 });
  });

  it('signin funciona após seed (verifyPassword com Demo123!)', async () => {
    const db = freshDb();
    await seed(db);
    const row = db.prepare('SELECT password_hash AS h FROM users WHERE email=?').get('alice@demo.local') as { h: string };
    await expect(verifyPassword(SEED_PASSWORD, row.h)).resolves.toBe(true);
  });

  it('seed 2× não duplica nem altera saldo modificado', async () => {
    const db = freshDb();
    await seed(db);
    await seed(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
    db.prepare(`UPDATE accounts SET balance_cents=1 WHERE id='acc-alice'`).run();
    await seed(db);
    expect(db.prepare(`SELECT balance_cents AS b FROM accounts WHERE id='acc-alice'`).get()).toEqual({ b: 1 });
  });

  it('reset limpa tudo e restaura; trigger do ledger continua ativo', async () => {
    const db = freshDb();
    await seed(db);
    // Sujeira em todas as tabelas.
    db.prepare(`INSERT INTO sessions (id,token_hash,user_id,created_at,expires_at,revoked_at) VALUES ('s1','h','user-alice','${T}','${T}',NULL)`).run();
    db.prepare(`INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES ('cx','user-bruno','acc-carla','Carla','${T}')`).run();
    db.prepare(`INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at)
      VALUES ('t9','acc-alice','acc-bruno',50,'PENDING',NULL,'CREATED',0,0,'k9','fp','${T}','${T}')`).run();
    db.prepare(`INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES ('l9','t9','acc-alice','DEBIT',-50,'${T}')`).run();
    db.prepare(`INSERT INTO jobs (id,transfer_id,status,run_after,attempts,created_at,updated_at) VALUES ('j9','t9','PENDING','${T}',0,'${T}','${T}')`).run();
    db.prepare(`INSERT INTO test_faults (id,source_account_id,idempotency_key,mode,armed_at) VALUES ('f9','acc-alice','k9','FAIL_CREDIT_ONCE','${T}')`).run();
    db.prepare(`UPDATE accounts SET balance_cents=5 WHERE id='acc-carla'`).run();

    await resetDatabase(db);

    for (const t of ['sessions', 'transfers', 'ledger_entries', 'jobs', 'test_faults']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('SELECT COUNT(*) AS n FROM contacts').get()).toEqual({ n: 1 });
    expect(totalBalances(db)).toBe(INITIAL_TOTAL_CENTS);
    const row = db.prepare('SELECT password_hash AS h FROM users WHERE id=?').get('user-carla') as { h: string };
    await expect(verifyPassword(SEED_PASSWORD, row.h)).resolves.toBe(true);
    // Trigger de imutabilidade recriado pelo migrate.
    db.prepare(`INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at)
      VALUES ('t10','acc-alice','acc-bruno',10,'PENDING',NULL,'CREATED',0,0,'k10','fp','${T}','${T}')`).run();
    db.prepare(`INSERT INTO ledger_entries (id,transfer_id,account_id,type,amount_cents,created_at) VALUES ('l10','t10','acc-alice','DEBIT',-10,'${T}')`).run();
    expect(() => db.prepare(`DELETE FROM ledger_entries WHERE id='l10'`).run()).toThrowError(/immutable/i);
  });
});
