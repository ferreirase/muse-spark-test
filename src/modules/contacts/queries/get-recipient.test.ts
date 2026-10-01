import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { AppError } from '../../../shared/errors.js';
import { getRecipient } from './get-recipient.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-recip-'));
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

describe('getRecipient', () => {
  it('Alice consulta acc-bruno → só accountId+name', async () => {
    const db = await freshDb();
    const r = getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'acc-bruno' });
    expect(r).toEqual({ accountId: 'acc-bruno', name: 'Bruno Demo' });
    expect(Object.keys(r).sort()).toEqual(['accountId', 'name']);
  });

  it('própria conta → 422 SELF_RECIPIENT', async () => {
    const db = await freshDb();
    try {
      getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'acc-alice' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('SELF_RECIPIENT');
      expect((err as AppError).statusCode).toBe(422);
    }
  });

  it('inexistente e caixa diferente → 404 RECIPIENT_NOT_FOUND', async () => {
    const db = await freshDb();
    for (const bad of ['acc-fantasma', 'ACC-BRUNO', ' acc-bruno', '']) {
      try {
        getRecipient(db, { requesterAccountId: 'acc-alice', accountId: bad });
        expect.unreachable();
      } catch (err) {
        expect((err as AppError).code).toBe('RECIPIENT_NOT_FOUND');
        expect((err as AppError).statusCode).toBe(404);
      }
    }
  });
});
