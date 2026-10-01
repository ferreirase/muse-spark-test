import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { getMe } from './get-me.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-getme-'));
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

describe('getMe', () => {
  it('shape exato, sem extras; Bruno não vê Alice', async () => {
    const db = await freshDb();
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const me = getMe(db, 'user-bruno');
    expect(Object.keys(me).sort()).toEqual(['account', 'user']);
    expect(Object.keys(me.user).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(Object.keys(me.account).sort()).toEqual(['balanceCents', 'currency', 'id']);
    expect(me).toEqual({
      user: { id: 'user-bruno', name: 'Bruno Demo', email: 'bruno@demo.local', createdAt: '2026-10-01T00:00:00.000Z' },
      account: { id: 'acc-bruno', currency: 'BRL', balanceCents: 25000 },
    });
    expect(JSON.stringify(me)).not.toMatch(/alice/i);
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
