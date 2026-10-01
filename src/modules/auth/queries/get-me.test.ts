import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { getMe } from './get-me.js';
import { getBalance } from '../../accounts/queries/get-balance.js';

let dir: string;
let db: Database.Database;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-me-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('getMe', () => {
  it('retorna AuthResult exato de Alice (sem campos extras)', () => {
    const r = getMe(db, 'user-alice');
    expect(r).toEqual({
      user: { id: 'user-alice', name: 'Alice Demo', email: 'alice@demo.local', createdAt: '2026-10-01T00:00:00.000Z' },
      account: { id: 'acc-alice', currency: 'BRL', balanceCents: 100000 },
    });
    expect(Object.keys(r!).sort()).toEqual(['account', 'user']);
  });

  it('getMe de Bruno não contém dados de Alice', () => {
    const r = getMe(db, 'user-bruno')!;
    expect(JSON.stringify(r)).not.toContain('alice');
    expect(r.account.balanceCents).toBe(25000);
  });

  it('usuário inexistente → null', () => {
    expect(getMe(db, 'ninguem')).toBeNull();
  });
});

describe('getBalance', () => {
  it('retorna Balance com centavos exatos e updatedAt ISO', () => {
    db.prepare("UPDATE accounts SET balance_cents=10001, updated_at='2026-10-01T13:00:00.000Z' WHERE id='acc-alice'").run();
    const b = getBalance(db, 'acc-alice');
    expect(b).toEqual({
      accountId: 'acc-alice',
      currency: 'BRL',
      balanceCents: 10001,
      updatedAt: '2026-10-01T13:00:00.000Z',
    });
  });

  it('conta inexistente → null', () => {
    expect(getBalance(db, 'acc-fantasma')).toBeNull();
  });
});

describe('queries não escrevem', () => {
  it('total_changes permanece 0 após getMe/getBalance', () => {
    const before = db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number };
    getMe(db, 'user-alice');
    getBalance(db, 'acc-alice');
    const after = db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number };
    expect(after.t).toBe(before.t);
  });
});
