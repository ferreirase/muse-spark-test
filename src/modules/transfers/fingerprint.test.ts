import { describe, expect, it } from 'vitest';
import { fingerprintTransferPayload } from './fingerprint.js';

describe('fingerprintTransferPayload', () => {
  it('ordem de chaves da entrada irrelevante; null vs ausente iguais', () => {
    const a = fingerprintTransferPayload({ recipientAccountId: 'acc-bruno', amountCents: 100, note: null });
    const b = fingerprintTransferPayload({ amountCents: 100, note: null, recipientAccountId: 'acc-bruno' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nota normalizada: " x " ≠ "x" no fingerprint se não normalizada — comando normaliza antes', () => {
    const a = fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 1, note: 'x' });
    const b = fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 1, note: ' x ' });
    expect(a).not.toBe(b);
    expect(fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 1, note: null })).not.toBe(a);
    expect(fingerprintTransferPayload({ recipientAccountId: 'y', amountCents: 1, note: null })).not.toBe(a);
    expect(fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 2, note: null })).not.toBe(a);
  });
});
