import { describe, expect, it } from 'vitest';
import { AppError } from './errors.js';
import {
  checkAmountCents,
  checkIdempotencyKey,
  checkPassword,
  normalizeEmail,
  normalizeName,
  normalizeNickname,
  normalizeNote,
  parseLimit,
} from './validation.js';

function fieldOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.details?.[0]?.field ?? '(sem details)';
    throw err;
  }
  throw new Error('era esperado validationError');
}

describe('normalizeName', () => {
  it('trim e limites exatos', () => {
    expect(normalizeName('  Alice  ')).toBe('Alice');
    expect(normalizeName('ab')).toBe('ab');
    expect(normalizeName('a'.repeat(80))).toBe('a'.repeat(80));
    expect(fieldOf(() => normalizeName('a'))).toBe('name');
    expect(fieldOf(() => normalizeName('a'.repeat(81)))).toBe('name');
    expect(fieldOf(() => normalizeName('   '))).toBe('name');
  });
});

describe('normalizeEmail', () => {
  it('trim + lowercase', () => {
    expect(normalizeEmail('  Alice@Demo.Local  ')).toBe('alice@demo.local');
  });
  it('rejeita inválidos e >254', () => {
    for (const bad of ['sem-arroba', 'a@', '@b.com', 'a@b', 'a b@c.com', '']) {
      expect(fieldOf(() => normalizeEmail(bad))).toBe('email');
    }
    expect(fieldOf(() => normalizeEmail(`${'a'.repeat(250)}@b.co`))).toBe('email');
  });
});

describe('checkPassword', () => {
  it('preserva espaços nas pontas byte a byte', () => {
    expect(checkPassword('  Demo123!  ')).toBe('  Demo123!  ');
    expect(checkPassword('a'.repeat(8))).toBe('a'.repeat(8));
    expect(checkPassword('a'.repeat(72))).toBe('a'.repeat(72));
    expect(fieldOf(() => checkPassword('curta'))).toBe('password');
    expect(fieldOf(() => checkPassword('a'.repeat(73)))).toBe('password');
  });
});

describe('normalizeNickname', () => {
  it('trim e limites', () => {
    expect(normalizeNickname(' Bruno ')).toBe('Bruno');
    expect(normalizeNickname('x')).toBe('x');
    expect(fieldOf(() => normalizeNickname(''))).toBe('nickname');
    expect(fieldOf(() => normalizeNickname('   '))).toBe('nickname');
    expect(fieldOf(() => normalizeNickname('a'.repeat(61)))).toBe('nickname');
  });
});

describe('normalizeNote', () => {
  it('ausente/vazia → null; trim aplicado', () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote('  almoço  ')).toBe('almoço');
    expect(normalizeNote('a'.repeat(140))).toBe('a'.repeat(140));
    expect(fieldOf(() => normalizeNote(` ${'a'.repeat(141)} `))).toBe('note');
  });
});

describe('checkAmountCents / parseLimit / idempotencyKey', () => {
  it('amountCents limites', () => {
    expect(checkAmountCents(1)).toBe(1);
    expect(checkAmountCents(100000000)).toBe(100000000);
    for (const bad of [0, 100000001, 10.5, '100', NaN, null]) {
      expect(fieldOf(() => checkAmountCents(bad))).toBe('amountCents');
    }
  });
  it('parseLimit', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('')).toBe(20);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('50')).toBe(50);
    for (const bad of ['0', '51', 'abc', '1.5', '-3', '100']) {
      expect(fieldOf(() => parseLimit(bad))).toBe('limit');
    }
  });
  it('idempotency-key pattern', () => {
    expect(checkIdempotencyKey('alice-bruno-001')).toBe('alice-bruno-001');
    for (const bad of ['curta', 'a'.repeat(129), 'com/espaço x', 'a/b', 'key with space', 'çãõ']) {
      expect(fieldOf(() => checkIdempotencyKey(bad))).toBe('idempotency-key');
    }
  });
});
