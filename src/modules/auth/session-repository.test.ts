import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed } from '../../db/seed.js';
import type { Clock } from '../../shared/clock.js';
import { hashSessionToken } from './session-token.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSession,
  resolveSession,
  revokeSession,
} from './session-repository.js';
import { cookieAttrs } from './cookie.js';

let dirs: string[] = [];
let dbs: Db[] = [];

function freshDb(): Db {
  const dir = mkdtempSync(join(tmpdir(), 'bank-sess-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 's.sqlite'));
  dbs.push(db);
  migrate(db);
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
function clockAt(ms: number): Clock {
  return { now: () => new Date(ms) };
}

describe('session-repository', () => {
  it('create → resolve retorna userId/accountId; banco guarda só o hash', async () => {
    const db = freshDb();
    await seed(db);
    const { token, expiresAt } = createSession(db, 'user-alice', clockAt(T0));
    const auth = resolveSession(db, token, clockAt(T0 + 1000));
    expect(auth).toEqual({ sessionId: expect.any(String), userId: 'user-alice', accountId: 'acc-alice' });
    expect(Date.parse(expiresAt) - T0).toBe(SESSION_TTL_MS);
    const rows = db.prepare('SELECT token_hash AS h FROM sessions').all() as { h: string }[];
    expect(rows).toHaveLength(1);
    const h = rows[0]?.h;
    expect(h).toBe(hashSessionToken(token));
    expect(h).not.toContain(token);
    expect(SESSION_COOKIE_NAME).toBe('bank_session');
  });

  it('expirada (now = expires_at e além) resolve null; revogada resolve null', async () => {
    const db = freshDb();
    await seed(db);
    const { token, expiresAt } = createSession(db, 'user-bruno', clockAt(T0));
    const exp = Date.parse(expiresAt);
    expect(resolveSession(db, token, clockAt(exp))).toBeNull();
    expect(resolveSession(db, token, clockAt(exp + 1))).toBeNull();
    const { token: t2 } = createSession(db, 'user-bruno', clockAt(T0));
    revokeSession(db, t2, clockAt(T0 + 10));
    expect(resolveSession(db, t2, clockAt(T0 + 20))).toBeNull();
  });

  it('revoke idempotente: token inexistente e 2× não lançam', async () => {
    const db = freshDb();
    await seed(db);
    expect(() => revokeSession(db, 'token-inexistente', clockAt(T0))).not.toThrow();
    const { token } = createSession(db, 'user-carla', clockAt(T0));
    revokeSession(db, token, clockAt(T0));
    expect(() => revokeSession(db, token, clockAt(T0 + 1))).not.toThrow();
    expect(resolveSession(db, 'outro-token', clockAt(T0))).toBeNull();
  });

  it('cookie attrs: HttpOnly, Lax, Path=/, Max-Age 86400, Secure conforme config', () => {
    const exp = new Date(T0 + SESSION_TTL_MS);
    expect(cookieAttrs(false, exp)).toEqual({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 86400,
      expires: exp,
    });
    expect(cookieAttrs(true, exp).secure).toBe(true);
  });
});
