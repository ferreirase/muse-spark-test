import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { addContact } from '../commands/add-contact.js';
import { listContacts } from './list-contacts.js';

let dir: string;
let db: Database.Database;
const NOW = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-ct-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('addContact', () => {
  it('Bruno adiciona Carla com apelido trimado → Contact completo', () => {
    const c = addContact({ db, now: NOW }, { ownerUserId: 'user-bruno', ownerAccountId: 'acc-bruno', nickname: ' Carlinha ', recipientAccountId: 'acc-carla' });
    expect(c).toEqual({
      id: expect.any(String),
      nickname: 'Carlinha',
      recipientAccountId: 'acc-carla',
      recipientName: 'Carla Demo',
      createdAt: NOW.toISOString(),
    });
  });

  it('duplicado (mesmo destinatário, apelido diferente) → 409', () => {
    expect(() =>
      addContact({ db, now: NOW }, { ownerUserId: 'user-alice', ownerAccountId: 'acc-alice', nickname: 'B runo', recipientAccountId: 'acc-bruno' }),
    ).toThrowError(expect.objectContaining({ code: 'CONTACT_ALREADY_EXISTS', statusCode: 409 }));
  });

  it('própria conta → 422 SELF_RECIPIENT; inexistente → 404', () => {
    expect(() =>
      addContact({ db, now: NOW }, { ownerUserId: 'user-alice', ownerAccountId: 'acc-alice', nickname: 'Eu', recipientAccountId: 'acc-alice' }),
    ).toThrowError(expect.objectContaining({ code: 'SELF_RECIPIENT' }));
    expect(() =>
      addContact({ db, now: NOW }, { ownerUserId: 'user-alice', ownerAccountId: 'acc-alice', nickname: 'Fantasma', recipientAccountId: 'acc-404' }),
    ).toThrowError(expect.objectContaining({ code: 'RECIPIENT_NOT_FOUND' }));
  });

  it('apelido vazio ou 61 chars após trim → 400 VALIDATION_ERROR', () => {
    expect(() =>
      addContact({ db, now: NOW }, { ownerUserId: 'user-alice', ownerAccountId: 'acc-alice', nickname: '   ', recipientAccountId: 'acc-bruno' }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() =>
      addContact({ db, now: NOW }, { ownerUserId: 'user-alice', ownerAccountId: 'acc-alice', nickname: 'n'.repeat(61), recipientAccountId: 'acc-bruno' }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});

describe('listContacts', () => {
  it('Alice vê só contact-bruno completo; Bruno não vê contatos de Alice', () => {
    const alice = listContacts(db, 'user-alice');
    expect(alice.length).toBe(1);
    expect(alice[0]).toEqual({
      id: 'contact-bruno',
      nickname: 'Bruno',
      recipientAccountId: 'acc-bruno',
      recipientName: 'Bruno Demo',
      createdAt: '2026-10-01T00:00:00.000Z',
    });
    expect(listContacts(db, 'user-bruno')).toEqual([]);
  });

  it('ordena por nickname e depois id (empate via SQL direto)', () => {
    addContact({ db, now: NOW }, { ownerUserId: 'user-carla', ownerAccountId: 'acc-carla', nickname: 'Zé', recipientAccountId: 'acc-alice' });
    addContact({ db, now: NOW }, { ownerUserId: 'user-carla', ownerAccountId: 'acc-carla', nickname: 'Ana', recipientAccountId: 'acc-bruno' });
    // mesmo nickname, destinatários distintos não são possíveis via comando
    // para carla (só há 2 outras contas) — empate injetado por SQL direto:
    db.prepare('INSERT INTO contacts (id,owner_user_id,recipient_account_id,nickname,created_at) VALUES (?,?,?,?,?)')
      .run('zzz-empate', 'user-alice', 'acc-carla', 'Bruno', NOW.toISOString());
    const list = listContacts(db, 'user-carla');
    expect(list.map((c) => c.nickname)).toEqual(['Ana', 'Zé']);
    const aliceList = listContacts(db, 'user-alice');
    expect(aliceList.map((c) => c.id)).toEqual(['contact-bruno', 'zzz-empate']); // nickname 'Bruno' empata; id decide
  });

  it('não escreve no banco (total_changes 0)', () => {
    const before = (db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number }).t;
    listContacts(db, 'user-alice');
    const after = (db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number }).t;
    expect(after).toBe(before);
  });
});
