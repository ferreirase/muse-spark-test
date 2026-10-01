import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  normalizeEmail,
  checkPassword,
  normalizeNickname,
  normalizeNote,
  parseLimit,
  checkIdempotencyKey,
} from './validation.js';
import { AppError } from './errors.js';

const expectFieldError = (fn: () => unknown, field: string) => {
  try {
    fn();
    expect.unreachable('deveria lançar');
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details?.[0]?.field).toBe(field);
  }
};

describe('normalizeName', () => {
  it('aplica trim', () => expect(normalizeName('  Alice Demo  ')).toBe('Alice Demo'));
  it('aceita limites exatos 2 e 80', () => {
    expect(normalizeName('ab')).toBe('ab');
    expect(normalizeName('a'.repeat(80))).toBe('a'.repeat(80));
  });
  it('rejeita 1 e 81 chars após trim', () => {
    expectFieldError(() => normalizeName('a'), 'name');
    expectFieldError(() => normalizeName('a'.repeat(81)), 'name');
  });
  it('rejeita não-string', () => expectFieldError(() => normalizeName(42 as never), 'name'));
});

describe('normalizeEmail', () => {
  it('trim + lowercase', () => expect(normalizeEmail('  Alice@DEMO.local ')).toBe('alice@demo.local'));
  it('aceita 254 chars', () => {
    const email254 = `${'a'.repeat(243)}@demo.local`;
    expect(email254.length).toBe(254);
    expect(normalizeEmail(email254)).toBe(email254);
  });
  it('rejeita 255 chars, formato inválido, vazio', () => {
    expectFieldError(() => normalizeEmail(`${'a'.repeat(244)}@demo.local`), 'email');
    expectFieldError(() => normalizeEmail('sem-arroba'), 'email');
    expectFieldError(() => normalizeEmail('a@b'), 'email');
    expectFieldError(() => normalizeEmail(''), 'email');
  });
});

describe('checkPassword', () => {
  it('aceita 8–72 e preserva espaços byte a byte', () => {
    expect(checkPassword('12345678')).toBe('12345678');
    const pw72 = 'x'.repeat(72);
    expect(checkPassword(pw72)).toBe(pw72);
    expect(checkPassword(' 1234567 ')).toBe(' 1234567 ');
  });
  it('rejeita 7 e 73 chars', () => {
    expectFieldError(() => checkPassword('1234567'), 'password');
    expectFieldError(() => checkPassword('x'.repeat(73)), 'password');
  });
});

describe('normalizeNickname', () => {
  it('trim 1–60', () => {
    expect(normalizeNickname(' Bruno ')).toBe('Bruno');
    expect(normalizeNickname('b'.repeat(60))).toBe('b'.repeat(60));
  });
  it('rejeita vazio e 61', () => {
    expectFieldError(() => normalizeNickname('   '), 'nickname');
    expectFieldError(() => normalizeNickname('b'.repeat(61)), 'nickname');
  });
});

describe('normalizeNote', () => {
  it('ausente/vazio/apenas espaços → null', () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('')).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
  });
  it('trim aplicado', () => expect(normalizeNote(' Almoço ')).toBe('Almoço'));
  it('aceita 140, rejeita 141 após trim', () => {
    expect(normalizeNote('n'.repeat(140))).toBe('n'.repeat(140));
    expectFieldError(() => normalizeNote('n'.repeat(141)), 'note');
  });
});

describe('parseLimit', () => {
  it('default 20 quando ausente', () => expect(parseLimit(undefined)).toBe(20));
  it('aceita 1 e 50', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('50')).toBe(50);
  });
  it('rejeita 0, 51, abc, 1.5', () => {
    for (const bad of ['0', '51', 'abc', '1.5']) expectFieldError(() => parseLimit(bad), 'limit');
  });
});

describe('checkIdempotencyKey', () => {
  it('aceita alice-bruno-001', () => expect(checkIdempotencyKey('alice-bruno-001')).toBe('alice-bruno-001'));
  it('rejeita 7 chars, 129 chars, / e espaço', () => {
    expectFieldError(() => checkIdempotencyKey('abc1234'), 'idempotency-key');
    expectFieldError(() => checkIdempotencyKey('k'.repeat(129)), 'idempotency-key');
    expectFieldError(() => checkIdempotencyKey('invalid/key!'), 'idempotency-key');
    expectFieldError(() => checkIdempotencyKey('with space1'), 'idempotency-key');
  });
});
