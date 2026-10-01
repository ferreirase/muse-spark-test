import { describe, it, expect } from 'vitest';
import { checkTestControlAccess } from './guard.js';

describe('checkTestControlAccess', () => {
  const TOKEN = 'token-1234567890abcdef';

  it('flag desligada → NOT_FOUND sempre', () => {
    expect(checkTestControlAccess({ enabled: false, expectedToken: TOKEN, providedToken: TOKEN })).toBe('NOT_FOUND');
    expect(checkTestControlAccess({ enabled: false, expectedToken: TOKEN, providedToken: undefined })).toBe('NOT_FOUND');
  });

  it('flag ligada sem header → FORBIDDEN', () => {
    expect(checkTestControlAccess({ enabled: true, expectedToken: TOKEN, providedToken: undefined })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ enabled: true, expectedToken: TOKEN, providedToken: '' })).toBe('FORBIDDEN');
  });

  it('token errado ou de tamanho diferente → FORBIDDEN', () => {
    expect(checkTestControlAccess({ enabled: true, expectedToken: TOKEN, providedToken: 'errado-1234567890' })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ enabled: true, expectedToken: TOKEN, providedToken: 'curto' })).toBe('FORBIDDEN');
  });

  it('token correto → OK', () => {
    expect(checkTestControlAccess({ enabled: true, expectedToken: TOKEN, providedToken: TOKEN })).toBe('OK');
  });
});
