import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { signup } from './signup.js';
import { signin } from './signin.js';
import { signout } from './signout.js';
import { resolveSession } from '../session-repository.js';
import { AppError } from '../../../shared/errors.js';

let dir: string;
let db: Database.Database;
const NOW = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-auth-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (t: string) => (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

describe('signup command', () => {
  it('cria user + conta saldo 0 + sessão atomicamente com e-mail normalizado', async () => {
    const r = await signup({ db, now: NOW }, { name: '  Nova Pessoa ', email: '  Nova@Exemplo.LOCAL ', password: 'SenhaForte123' });
    expect(r.authResult.user.email).toBe('nova@exemplo.local');
    expect(r.authResult.user.name).toBe('Nova Pessoa');
    expect(r.authResult.account.balanceCents).toBe(0);
    expect(r.authResult.account.currency).toBe('BRL');
    expect(count('users')).toBe(4);
    expect(count('accounts')).toBe(4);
    expect(count('sessions')).toBe(1);
    const hash = db.prepare('SELECT password_hash FROM users WHERE email=?').get('nova@exemplo.local') as { password_hash: string };
    expect(hash.password_hash.startsWith('scrypt$')).toBe(true);
    expect(resolveSession(db, r.session.token, NOW)).toMatchObject({ userId: r.authResult.user.id });
  });

  it('e-mail duplicado (case/trim) → 409 EMAIL_ALREADY_EXISTS sem criar nada', async () => {
    await expect(
      signup({ db, now: NOW }, { name: 'Alice', email: '  ALICE@demo.local ', password: 'SenhaForte123' }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS', statusCode: 409 });
    expect(count('users')).toBe(3);
    expect(count('accounts')).toBe(3);
    expect(count('sessions')).toBe(0);
  });

  it('falha ao criar sessão não deixa usuário órfão (atomicidade)', async () => {
    const boom = () => {
      throw new Error('session insert failed');
    };
    await expect(
      signup({ db, now: NOW, createSession: boom }, { name: 'X Y', email: 'xy@z.co', password: 'SenhaForte123' }),
    ).rejects.toThrow('session insert failed');
    expect(count('users')).toBe(3);
    expect(count('accounts')).toBe(3);
  });

  it('valida nome e senha com VALIDATION_ERROR', async () => {
    await expect(signup({ db, now: NOW }, { name: 'a', email: 'a@b.co', password: 'SenhaForte123' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(signup({ db, now: NOW }, { name: 'ok nome', email: 'a@b.co', password: '1234567' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(signup({ db, now: NOW }, { name: 'ok nome', email: 'a@b.co', password: 'x'.repeat(73) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('signin command', () => {
  it('autentica alice@demo.local/Demo123! e cria sessão', async () => {
    const r = await signin({ db, now: NOW }, { email: 'alice@demo.local', password: 'Demo123!' });
    expect(r.authResult.user.id).toBe('user-alice');
    expect(r.authResult.account).toEqual({ id: 'acc-alice', currency: 'BRL', balanceCents: 100000 });
    expect(resolveSession(db, r.session.token, NOW)).toBeTruthy();
  });

  it('e-mail com maiúsculas/espaços funciona', async () => {
    const r = await signin({ db, now: NOW }, { email: '  Alice@DEMO.local ', password: 'Demo123!' });
    expect(r.authResult.user.id).toBe('user-alice');
  });

  it('senha errada e e-mail inexistente → 401 idêntico', async () => {
    const errs: AppError[] = [];
    for (const input of [
      { email: 'alice@demo.local', password: 'Errada123!' },
      { email: 'fantasma@demo.local', password: 'SenhaForte123' },
    ]) {
      try {
        await signin({ db, now: NOW }, input);
        expect.unreachable();
      } catch (e) {
        errs.push(e as AppError);
      }
    }
    expect(errs[0]!.statusCode).toBe(401);
    expect(errs[0]!.code).toBe('INVALID_CREDENTIALS');
    expect(errs[0]!.message).toBe(errs[1]!.message);
    expect(errs[0]!.code).toBe(errs[1]!.code);
    expect(count('sessions')).toBe(0);
  });
});

describe('signout command', () => {
  it('revoga sessão válida; resolve null depois', async () => {
    const r = await signin({ db, now: NOW }, { email: 'alice@demo.local', password: 'Demo123!' });
    expect(resolveSession(db, r.session.token, NOW)).toBeTruthy();
    signout({ db, now: NOW }, r.session.token);
    expect(resolveSession(db, r.session.token, NOW)).toBeNull();
  });

  it('sem token ou token desconhecido não lança', () => {
    expect(() => signout({ db, now: NOW }, undefined)).not.toThrow();
    expect(() => signout({ db, now: NOW }, 'token-nada')).not.toThrow();
  });
});
