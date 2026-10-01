import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { getBalance } from './get-balance.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-balb-'));
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

describe('getBalance', () => {
  it('Alice → 100000; centavos exatos após UPDATE; sem escrita', async () => {
    const db = await freshDb();
    expect(getBalance(db, 'acc-alice')).toEqual({
      accountId: 'acc-alice',
      currency: 'BRL',
      balanceCents: 100000,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    db.prepare(`UPDATE accounts SET balance_cents=10001 WHERE id='acc-alice'`).run();
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const b = getBalance(db, 'acc-alice');
    expect(b.balanceCents).toBe(10001);
    expect(typeof b.updatedAt).toBe('string');
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    expect(after).toBe(before);
  });
});
