import { describe, expect, it } from 'vitest';
import { isOriginAllowed } from './origin.js';

const ALLOWED = 'http://127.0.0.1:3000';

describe('isOriginAllowed', () => {
  it('métodos seguros sempre passam', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(isOriginAllowed({ method, origin: 'http://evil.local', allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: undefined, allowedOrigin: ALLOWED })).toBe(true);
    }
  });

  it('mutações: sem Origin passam; igual passa; diferente bloqueia', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isOriginAllowed({ method, origin: undefined, allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: '', allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: ALLOWED, allowedOrigin: ALLOWED })).toBe(true);
      expect(isOriginAllowed({ method, origin: 'http://evil.local', allowedOrigin: ALLOWED })).toBe(false);
      expect(isOriginAllowed({ method, origin: 'null', allowedOrigin: ALLOWED })).toBe(false);
      expect(isOriginAllowed({ method, origin: 'http://127.0.0.1:3001', allowedOrigin: ALLOWED })).toBe(false);
      expect(isOriginAllowed({ method, origin: 'https://127.0.0.1:3000', allowedOrigin: ALLOWED })).toBe(false);
    }
  });
});
