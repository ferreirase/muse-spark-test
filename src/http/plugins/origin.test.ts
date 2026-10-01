import { describe, it, expect } from 'vitest';
import { isOriginAllowed } from './origin.js';

const ALLOWED = 'http://127.0.0.1:3000';

describe('isOriginAllowed', () => {
  it('métodos seguros sempre passam, qualquer origin', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isOriginAllowed({ method, origin: 'http://evil.local', allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: undefined, allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: 'null', allowedOrigin: ALLOWED })).toBe(true);
    }
  });

  it('mutação sem Origin passa (CLI/testes)', () => {
    for (const origin of [undefined, ''] as (string | undefined)[]) {
      expect(isOriginAllowed({ method: 'POST', origin, allowedOrigin: ALLOWED })).toBe(true);
    }
  });

  it('mutação com origin configurada passa; outra origin é bloqueada', () => {
    expect(isOriginAllowed({ method: 'POST', origin: ALLOWED, allowedOrigin: ALLOWED })).toBe(true);
    expect(isOriginAllowed({ method: 'POST', origin: 'http://evil.local', allowedOrigin: ALLOWED })).toBe(false);
  });

  it('variação de porta ou esquema é considerada outra origem', () => {
    expect(isOriginAllowed({ method: 'PUT', origin: 'http://127.0.0.1:3001', allowedOrigin: ALLOWED })).toBe(false);
    expect(isOriginAllowed({ method: 'PUT', origin: 'https://127.0.0.1:3000', allowedOrigin: ALLOWED })).toBe(false);
  });

  it('origin literal "null" em mutação é bloqueada', () => {
    expect(isOriginAllowed({ method: 'POST', origin: 'null', allowedOrigin: ALLOWED })).toBe(false);
  });

  it('método em minúsculas continua mutação', () => {
    expect(isOriginAllowed({ method: 'post', origin: 'http://evil.local', allowedOrigin: ALLOWED })).toBe(false);
  });
});
