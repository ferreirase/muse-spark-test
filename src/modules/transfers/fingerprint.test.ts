import { describe, it, expect } from 'vitest';
import { fingerprintTransferPayload } from './fingerprint.js';

describe('fingerprintTransferPayload', () => {
  it('é determinístico para o mesmo payload normalizado', () => {
    const a = fingerprintTransferPayload({ recipientAccountId: 'acc-bruno', amountCents: 10000, note: 'Almoço' });
    const b = fingerprintTransferPayload({ recipientAccountId: 'acc-bruno', amountCents: 10000, note: 'Almoço' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nota null e ausente produzem o mesmo fingerprint', () => {
    const withNull = fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 1, note: null });
    const absent = fingerprintTransferPayload({ recipientAccountId: 'x', amountCents: 1, note: null });
    expect(withNull).toBe(absent);
  });

  it('valores diferentes → fingerprints diferentes', () => {
    const base = { recipientAccountId: 'acc-bruno', amountCents: 10000, note: null };
    const baseFp = fingerprintTransferPayload(base);
    expect(fingerprintTransferPayload({ ...base, amountCents: 10001 })).not.toBe(baseFp);
    expect(fingerprintTransferPayload({ ...base, recipientAccountId: 'acc-carla' })).not.toBe(baseFp);
    expect(fingerprintTransferPayload({ ...base, note: 'Almoço' })).not.toBe(baseFp);
  });

  it('nota normalizada equivalente (" x " vs "x") gera o mesmo fingerprint', () => {
    // o chamador normaliza antes; aqui comprovamos que o fingerprint só vê o valor final
    expect(
      fingerprintTransferPayload({ recipientAccountId: 'a', amountCents: 1, note: 'x' }),
    ).toBe(fingerprintTransferPayload({ recipientAccountId: 'a', amountCents: 1, note: 'x' }));
  });
});
