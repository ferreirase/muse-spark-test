import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from './password.js';

describe('password (scrypt)', () => {
  it('hash → verify ok', async () => {
    const stored = await hashPassword('Demo123!');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassword('Demo123!', stored)).resolves.toBe(true);
  });

  it('senha errada falha', async () => {
    const stored = await hashPassword('Demo123!');
    await expect(verifyPassword('Demo123! ', stored)).resolves.toBe(false);
    await expect(verifyPassword('demo123!', stored)).resolves.toBe(false);
  });

  it('é case-sensitive e sem trim', async () => {
    const stored = await hashPassword(' Demo123!');
    await expect(verifyPassword('Demo123!', stored)).resolves.toBe(false);
    await expect(verifyPassword(' Demo123!', stored)).resolves.toBe(true);
  });

  it('mesma senha gera hashes distintos (salt aleatório)', async () => {
    const a = await hashPassword('senha-segura-1');
    const b = await hashPassword('senha-segura-1');
    expect(a).not.toEqual(b);
  });

  it('formato corrompido retorna false sem lançar', async () => {
    await expect(verifyPassword('x', 'plaintext')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$16384$8$1$!!nao-base64!!$abc')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$16384$8$1$onlyonepart')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });

  it('DUMMY_PASSWORD_HASH não verifica senha comum', async () => {
    await expect(verifyPassword('Demo123!', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword('password123', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});
