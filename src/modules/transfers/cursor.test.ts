import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from './cursor.js';

describe('cursor', () => {
  it('roundtrip preserva createdAt e id', () => {
    const c = encodeCursor({ createdAt: '2026-10-01T00:00:00.000Z', id: 't-1' });
    expect(typeof c).toBe('string');
    expect(c).not.toContain('{');
    expect(decodeCursor(c)).toEqual({ createdAt: '2026-10-01T00:00:00.000Z', id: 't-1' });
  });

  it('base64 inválido → VALIDATION_ERROR field cursor', () => {
    expect(() => decodeCursor('!!!não-base64!!!')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: [{ field: 'cursor', message: expect.any(String) }] }),
    );
  });

  it('JSON inválido → VALIDATION_ERROR', () => {
    expect(() => decodeCursor(Buffer.from('não json').toString('base64url'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('array de tamanho errado → VALIDATION_ERROR', () => {
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['só-um'])).toString('base64url'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['a', 'b', 'c'])).toString('base64url'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });

  it('data inválida ou tipos errados → VALIDATION_ERROR', () => {
    expect(() => decodeCursor(Buffer.from(JSON.stringify(['2026-13-99T99:99:99.999Z', 't1'])).toString('base64url'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => decodeCursor(Buffer.from(JSON.stringify([123, 't1'])).toString('base64url'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
