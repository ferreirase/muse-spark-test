import { describe, expect, it } from 'vitest';
import { checkTestControlAccess } from './guard.js';

describe('checkTestControlAccess', () => {
  it('desligado → NOT_FOUND mesmo com token correto', () => {
    expect(checkTestControlAccess({ enabled: false, expectedToken: '0123456789abcdef', providedToken: '0123456789abcdef' })).toBe('NOT_FOUND');
  });
  it('ligado: ausente/errado/tamanho diferente → FORBIDDEN; correto → OK', () => {
    const base = { enabled: true, expectedToken: '0123456789abcdef' };
    expect(checkTestControlAccess({ ...base, providedToken: undefined })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ ...base, providedToken: '' })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ ...base, providedToken: 'xxxxxxxxxxxxxxxx' })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ ...base, providedToken: 'curto' })).toBe('FORBIDDEN');
    expect(checkTestControlAccess({ ...base, providedToken: '0123456789abcdef' })).toBe('OK');
  });
});
