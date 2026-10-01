import { describe, expect, it } from 'vitest';
import { TransientExhaustedError, isTransientSqliteError, withRetry } from './retry.js';

function busy(): Error {
  return Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
}

describe('withRetry', () => {
  it('sucesso na 3ª tentativa; delays crescentes ≤ maxMs', async () => {
    const delays: number[] = [];
    let calls = 0;
    const out = await withRetry(
      () => {
        calls += 1;
        if (calls < 3) throw busy();
        return 'ok';
      },
      { attempts: 5, baseMs: 25, maxMs: 1000, sleep: async () => undefined, random: () => 0, onDelay: (d) => delays.push(d) },
    );
    expect(out).toBe('ok');
    expect(delays).toEqual([25, 50]);
  });

  it('esgota após N e lança TransientExhaustedError', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          throw Object.assign(new Error('locked'), { code: 'SQLITE_LOCKED' });
        },
        { attempts: 3, sleep: async () => undefined, random: () => 0 },
      ),
    ).rejects.toBeInstanceOf(TransientExhaustedError);
    expect(calls).toBe(3);
  });

  it('erro não transitório propaga sem retry', async () => {
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          throw new Error('boom definitivo');
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrowError('boom definitivo');
    expect(calls).toBe(1);
  });

  it('isTransientSqliteError só para BUSY/LOCKED', () => {
    expect(isTransientSqliteError(busy())).toBe(true);
    expect(isTransientSqliteError(Object.assign(new Error('x'), { code: 'SQLITE_LOCKED' }))).toBe(true);
    expect(isTransientSqliteError(Object.assign(new Error('x'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))).toBe(false);
    expect(isTransientSqliteError(new Error('x'))).toBe(false);
    expect(isTransientSqliteError(null)).toBe(false);
  });

  it('delay respeita maxMs', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        () => {
          calls += 1;
          throw busy();
        },
        { attempts: 4, baseMs: 100, maxMs: 120, sleep: async () => undefined, random: () => 0.99, onDelay: (d) => delays.push(d) },
      ),
    ).rejects.toBeInstanceOf(TransientExhaustedError);
    expect(calls).toBe(4);
    expect(delays.every((d) => d <= 120)).toBe(true);
  });
});
