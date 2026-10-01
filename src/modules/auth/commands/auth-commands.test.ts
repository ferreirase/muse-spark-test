import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import type { Clock } from '../../../shared/clock.js';
import { AppError } from '../../../shared/errors.js';
import { createSession } from '../session-repository.js';
import { resolveSession } from '../session-repository.js';
import { signin, signout, signup } from './auth-commands.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-authcmd-'));
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

function codeOf(err: unknown): string {
  return err instanceof AppError ? err.code : `NÃO-AppError: ${String(err)}`;
}

describe('auth commands', () => {
  it('signup feliz: linhas criadas, saldo 0, email normalizado, hash scrypt', async () => {
    const db = await freshDb();
    const { authResult, session } = await signup(
      { db, clock },
      { name: '  Diego  ', email: '  DIEGO@Demo.Local ', password: 'Secreta99' },
    );
    expect(authResult.account.balanceCents).toBe(0);
    expect(authResult.user.email).toBe('diego@demo.local');
    expect(authResult.user.name).toBe('Diego');
    const row = db.prepare('SELECT email,password_hash AS h FROM users WHERE id=?').get(authResult.user.id) as { email: string; h: string };
    expect(row.email).toBe('diego@demo.local');
    expect(row.h.startsWith('scrypt$')).toBe(true);
    expect(resolveSession(db, session.token, clock)).toMatchObject({ userId: authResult.user.id });
    expect(JSON.stringify(authResult)).not.toMatch(/password|hash|token/i);
  });

  it('signup duplicado (case/trim) → 409, nada criado', async () => {
    const db = await freshDb();
    await expect(
      signup({ db, clock }, { name: 'Outra Alice', email: '  ALICE@demo.local ', password: 'Secreta99' }),
    ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
    try {
      await signup({ db, clock }, { name: 'A', email: 'nova@demo.local', password: 'Secreta99' });
    } catch (err) {
      expect(codeOf(err)).toBe('VALIDATION_ERROR');
    }
    try {
      await signup({ db, clock }, { name: 'Ok Nome', email: 'nova@demo.local', password: 'curta' });
    } catch (err) {
      expect(codeOf(err)).toBe('VALIDATION_ERROR');
    }
    try {
      await signup({ db, clock }, { name: 'Ok Nome', email: 'nova@demo.local', password: 'a'.repeat(73) });
    } catch (err) {
      expect(codeOf(err)).toBe('VALIDATION_ERROR');
    }
  });

  it('atomicidade: falha ao criar sessão não deixa órfão', async () => {
    const db = await freshDb();
    const boom = (): never => {
      throw new Error('sessão quebrou');
    };
    await expect(
      signup({ db, clock, createSessionFn: boom as unknown as typeof createSession }, { name: 'Orfao', email: 'orfao@demo.local', password: 'Secreta99' }),
    ).rejects.toThrowError('sessão quebrou');
    expect(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('orfao@demo.local')).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 3 });
  });

  it('signin ok com seed; maiúsculas funcionam; erros idênticos', async () => {
    const db = await freshDb();
    const { authResult } = await signin({ db, clock }, { email: 'alice@demo.local', password: 'Demo123!' });
    expect(authResult.user.id).toBe('user-alice');
    expect(authResult.account).toEqual({ id: 'acc-alice', currency: 'BRL', balanceCents: 100000 });
    const upper = await signin({ db, clock }, { email: '  ALICE@DEMO.LOCAL ', password: 'Demo123!' });
    expect(upper.authResult.user.id).toBe('user-alice');

    const errWrong = await signin({ db, clock }, { email: 'alice@demo.local', password: 'Errada123' }).catch((e: unknown) => e);
    const errMissing = await signin({ db, clock }, { email: 'ninguem@demo.local', password: 'Errada123' }).catch((e: unknown) => e);
    expect(errWrong).toBeInstanceOf(AppError);
    expect(errMissing).toBeInstanceOf(AppError);
    expect({ c: codeOf(errWrong), m: (errWrong as AppError).message }).toEqual({
      c: 'INVALID_CREDENTIALS',
      m: (errMissing as AppError).message,
    });
    expect((errWrong as AppError).statusCode).toBe(401);
  });

  it('signout revoga; sem token/token desconhecido não lança; sessão revogada não autentica', async () => {
    const db = await freshDb();
    const { session } = await signin({ db, clock }, { email: 'bruno@demo.local', password: 'Demo123!' });
    expect(resolveSession(db, session.token, clock)).not.toBeNull();
    signout({ db, clock }, session.token);
    expect(resolveSession(db, session.token, clock)).toBeNull();
    expect(() => signout({ db, clock }, undefined)).not.toThrow();
    expect(() => signout({ db, clock }, 'desconhecido')).not.toThrow();
  });
});
