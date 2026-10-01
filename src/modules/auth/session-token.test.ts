import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken } from './session-token.js';

describe('session-token', () => {
  it('token tem 43 chars base64url', () => {
    for (let i = 0; i < 10; i++) {
      const t = generateSessionToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });

  it('1000 tokens sem colisão', () => {
    const set = new Set<string>();
    for (let i = 0; i < 1000; i++) set.add(generateSessionToken());
    expect(set.size).toBe(1000);
  });

  it('hash é sha256 hex determinístico e diferente do token', () => {
    const t = generateSessionToken();
    const h1 = hashSessionToken(t);
    const h2 = hashSessionToken(t);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(t);
    expect(hashSessionToken(generateSessionToken())).not.toBe(h1);
  });
});
