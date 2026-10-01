import { describe, expect, it } from 'vitest';
import { AppError } from '../../shared/errors.js';
import { decodeCursor, encodeCursor } from './cursor.js';

describe('cursor', () => {
  it('roundtrip', () => {
    const c = encodeCursor({ createdAt: '2026-10-01T19:00:00.000Z', id: 't-1' });
    expect(decodeCursor(c)).toEqual({ createdAt: '2026-10-01T19:00:00.000Z', id: 't-1' });
    expect(c).not.toMatch(/[+/=]/);
  });

  it('inválidos → VALIDATION_ERROR field cursor', () => {
    for (const bad of [
      '!!!',
      Buffer.from('não-json').toString('base64url'),
      Buffer.from('{}').toString('base64url'),
      Buffer.from('[1,2,3]').toString('base64url'),
      Buffer.from('["só-um"]').toString('base64url'),
      Buffer.from('["não-data","x"]').toString('base64url'),
      Buffer.from('[123,"x"]').toString('base64url'),
      Buffer.from('["2026-10-01T19:00:00.000Z",""]').toString('base64url'),
      '',
      123,
      null,
    ]) {
      try {
        decodeCursor(bad);
        expect.unreachable(`era esperado erro para ${String(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe('VALIDATION_ERROR');
        expect((err as AppError).details?.[0]?.field).toBe('cursor');
      }
    }
  });
});
