import { describe, it, expect } from 'vitest';
import { withRetry, isTransientSqliteError, TransientExhaustedError } from './retry.js';

const busyError = (code = 'SQLITE_BUSY') =>
  Object.assign(new Error('database is locked'), { code });

const noSleep = async () => {};

describe('isTransientSqliteError', () => {
  it('reconhece BUSY, BUSY_SNAPSHOT e LOCKED', () => {
    expect(isTransientSqliteError(busyError())).toBe(true);
    expect(isTransientSqliteError(busyError('SQLITE_BUSY_SNAPSHOT'))).toBe(true);
    expect(isTransientSqliteError(busyError('SQLITE_LOCKED'))).toBe(true);
    expect(isTransientSqliteError(busyError('SQLITE_CONSTRAINT_UNIQUE'))).toBe(false);
    expect(isTransientSqliteError(new Error('x'))).toBe(false);
    expect(isTransientSqliteError('não-erro')).toBe(false);
  });
});

describe('withRetry', () => {
  it('sucesso na 3ª tentativa com 2 sleeps', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const r = await withRetry(
      () => {
        calls++;
        if (calls < 3) throw busyError();
        return 'ok';
      },
      { attempts: 5, baseMs: 25, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 },
    );
    expect(r).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps.length).toBe(2);
  });

  it('esgotamento lança TransientExhaustedError com causa', async () => {
    const err = busyError();
    let calls = 0;
    await expect(
      withRetry(() => { calls++; throw err; }, { attempts: 4, baseMs: 25, sleep: noSleep, random: () => 0 }),
    ).rejects.toBeInstanceOf(TransientExhaustedError);
    expect(calls).toBe(4);
  });

  it('erro não transitório propaga sem retry', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const boom = Object.assign(new Error('constraint'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    await expect(
      withRetry(() => { calls++; throw boom; }, { attempts: 5, baseMs: 25, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 }),
    ).rejects.toThrow('constraint');
    expect(calls).toBe(1);
    expect(sleeps.length).toBe(0);
  });

  it('delays crescentes e limitados ao maxMs', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await withRetry(
      () => { calls++; throw busyError(); },
      { attempts: 9, baseMs: 25, maxMs: 200, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.999 },
    ).catch(() => undefined);
    expect(sleeps.length).toBe(8);
    for (let i = 1; i < sleeps.length; i++) {
      expect(sleeps[i]!).toBeGreaterThanOrEqual(sleeps[i - 1]!);
    }
    for (const s of sleeps) expect(s).toBeLessThanOrEqual(200);
  });
});
