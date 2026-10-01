import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import type { Clock } from '../../../shared/clock.js';
import { AppError } from '../../../shared/errors.js';
import { addContact } from './add-contact.js';
import { listContacts } from '../queries/list-contacts.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-ctt-'));
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

const T0 = Date.parse('2026-10-01T19:00:00.000Z');
const clock: Clock = { now: () => new Date(T0) };

function codeOf(p: Promise<unknown>): Promise<string> {
  return p.then(
    () => 'SEM-ERRO',
    (err: unknown) => (err instanceof AppError ? err.code : `NÃO-AppError: ${String(err)}`),
  );
}

describe('contacts', () => {
  it('Alice lista só contact-bruno inicialmente', async () => {
    const db = await freshDb();
    const items = listContacts(db, 'user-alice');
    expect(items).toEqual([
      { id: 'contact-bruno', nickname: 'Bruno', recipientAccountId: 'acc-bruno', recipientName: 'Bruno Demo', createdAt: '2026-10-01T00:00:00.000Z' },
    ]);
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    listContacts(db, 'user-alice');
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    expect(after).toBe(before);
  });

  it('Bruno adiciona Carla (trim); duplicado/self/inexistente/inválido', async () => {
    const db = await freshDb();
    const c = addContact(
      { db, clock },
      { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: '  Carla  ', recipientAccountId: 'acc-carla' },
    );
    expect(c.nickname).toBe('Carla');
    expect(c.recipientName).toBe('Carla Demo');
    expect(await codeOf(Promise.resolve().then(() => addContact({ db, clock }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'Outro Nome', recipientAccountId: 'acc-carla' })))).toBe('CONTACT_ALREADY_EXISTS');
    expect(await codeOf(Promise.resolve().then(() => addContact({ db, clock }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'Eu', recipientAccountId: 'acc-bruno' })))).toBe('SELF_RECIPIENT');
    expect(await codeOf(Promise.resolve().then(() => addContact({ db, clock }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'X', recipientAccountId: 'acc-nope' })))).toBe('RECIPIENT_NOT_FOUND');
    expect(await codeOf(Promise.resolve().then(() => addContact({ db, clock }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: '   ', recipientAccountId: 'acc-carla' })))).toBe('VALIDATION_ERROR');
    expect(await codeOf(Promise.resolve().then(() => addContact({ db, clock }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'a'.repeat(61), recipientAccountId: 'acc-alice' })))).toBe('VALIDATION_ERROR');
  });

  it('ordenação por nickname + id; isolamento entre donos', async () => {
    const db = await freshDb();
    // Bruno adiciona Alice e Carla com mesmo nickname para forçar empate.
    const c1 = addContact({ db, clock, uuid: () => 'cc-aaa' }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'Zé', recipientAccountId: 'acc-alice' });
    const c2 = addContact({ db, clock, uuid: () => 'cc-bbb' }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: 'Ana', recipientAccountId: 'acc-carla' });
    void c1;
    void c2;
    const items = listContacts(db, 'user-bruno');
    expect(items.map((c) => c.nickname)).toEqual(['Ana', 'Zé']);
    // Empate de nickname: menor id primeiro.
    const d1 = addContact({ db, clock, uuid: () => 'dd-002' }, { ownerUserId: 'user-carla', ownerAccountId: 'acc-carla', nickname: 'Parc', recipientAccountId: 'acc-alice' });
    const d2 = addContact({ db, clock, uuid: () => 'dd-001' }, { ownerUserId: 'user-carla', ownerAccountId: 'acc-carla', nickname: 'Parc', recipientAccountId: 'acc-bruno' });
    void d1;
    void d2;
    expect(listContacts(db, 'user-carla').map((c) => c.id)).toEqual(['dd-001', 'dd-002']);
    // Bruno não vê contatos de Alice.
    expect(listContacts(db, 'user-bruno').every((c) => c.id !== 'contact-bruno')).toBe(true);
  });
});
