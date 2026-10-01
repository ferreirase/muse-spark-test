import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import {
  SESSION_TTL_MS,
  createSession,
  resolveSession,
  revokeSession,
  authenticate,
} from './session-repository.js';
import { hashSessionToken } from './session-token.js';

let dir: string;
let db: Database.Database;
const T0 = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-sess-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('session repository', () => {
  it('create → resolve retorna userId/accountId corretos', () => {
    const { token, expiresAt } = createSession(db, 'user-alice', T0);
    expect(expiresAt).toBe(new Date(T0.getTime() + SESSION_TTL_MS).toISOString());
    const resolved = resolveSession(db, token, T0);
    expect(resolved).toBeTruthy();
    expect(resolved!.userId).toBe('user-alice');
    expect(resolved!.accountId).toBe('acc-alice');
    expect(typeof resolved!.sessionId).toBe('string');
  });

  it('expira exatamente em expires_at (fronteira inclusiva → null)', () => {
    const { token, expiresAt } = createSession(db, 'user-alice', T0);
    expect(resolveSession(db, token, new Date(expiresAt))).toBeNull();
    expect(resolveSession(db, token, new Date(T0.getTime() + SESSION_TTL_MS + 1))).toBeNull();
    expect(resolveSession(db, token, new Date(T0.getTime() + SESSION_TTL_MS - 1))).toBeTruthy();
  });

  it('revogada resolve null; revoke 2× não lança', () => {
    const { token } = createSession(db, 'user-bruno', T0);
    expect(resolveSession(db, token, T0)).toBeTruthy();
    revokeSession(db, token, T0);
    expect(resolveSession(db, token, T0)).toBeNull();
    expect(() => revokeSession(db, token, T0)).not.toThrow();
  });

  it('revoke com token inexistente não lança (signout idempotente)', () => {
    expect(() => revokeSession(db, 'token-que-nao-existe', T0)).not.toThrow();
  });

  it('token desconhecido resolve null', () => {
    expect(resolveSession(db, 'nin', T0)).toBeNull();
  });

  it('banco guarda só o hash; nenhuma linha contém o token em claro', () => {
    const { token } = createSession(db, 'user-carla', T0);
    const row = db.prepare('SELECT * FROM sessions').get() as Record<string, string | null>;
    expect(row.token_hash).toBe(hashSessionToken(token));
    const all = JSON.stringify(row);
    expect(all).not.toContain(token);
  });

  it('authenticate puro retorna auth ou null', () => {
    const { token } = createSession(db, 'user-alice', T0);
    expect(authenticate(db, token, T0)).toEqual({
      sessionId: expect.any(String),
      userId: 'user-alice',
      accountId: 'acc-alice',
    });
    expect(authenticate(db, token, new Date(T0.getTime() + SESSION_TTL_MS))).toBeNull();
    expect(authenticate(db, 'ruim', T0)).toBeNull();
  });
});
