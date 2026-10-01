import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { findRecipient, getRecipient } from './get-recipient.js';

let dir: string;
let db: Database.Database;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-rcp-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('getRecipient', () => {
  it('Alice consulta acc-bruno → só accountId e name', () => {
    const r = getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'acc-bruno' });
    expect(r).toEqual({ accountId: 'acc-bruno', name: 'Bruno Demo' });
    expect(Object.keys(r!).sort()).toEqual(['accountId', 'name']);
  });

  it('própria conta → 422 SELF_RECIPIENT', () => {
    try {
      getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'acc-alice' });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: 'SELF_RECIPIENT', statusCode: 422 });
    }
  });

  it('ID inexistente → 404 RECIPIENT_NOT_FOUND', () => {
    try {
      getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'acc-fantasma' });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: 'RECIPIENT_NOT_FOUND', statusCode: 404 });
    }
  });

  it('caixa diferente não resolve (ID exato, sem normalização)', () => {
    expect(() => getRecipient(db, { requesterAccountId: 'acc-alice', accountId: 'ACC-BRUNO' })).toThrowError();
  });

  it('findRecipient cru devolve nome do dono da conta', () => {
    expect(findRecipient(db, 'acc-carla')).toEqual({ accountId: 'acc-carla', name: 'Carla Demo' });
    expect(findRecipient(db, 'nope')).toBeNull();
  });
});
