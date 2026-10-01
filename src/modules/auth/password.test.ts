import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.js';

describe('password', () => {
  it('hash → verify ok; mesma senha gera hashes diferentes (salt aleatório)', async () => {
    const a = await hashPassword('Demo123!');
    const b = await hashPassword('Demo123!');
    expect(a).not.toBe(b);
    expect(await verifyPassword('Demo123!', a)).toBe(true);
    expect(await verifyPassword('Demo123!', b)).toBe(true);
  });

  it('é exata: case e espaços importam (sem trim)', async () => {
    const h = await hashPassword('Demo123!');
    expect(await verifyPassword('demo123!', h)).toBe(false);
    expect(await verifyPassword('Demo123! ', h)).toBe(false);
    expect(await verifyPassword(' Demo123!', h)).toBe(false);
    expect(await verifyPassword('outra-senha', h)).toBe(false);
  });

  it('formato inválido retorna false sem lançar', async () => {
    for (const bad of [
      'plaintext',
      'scrypt$16384$8',
      'bcrypt$10$salt$hash$extra$tudo',
      'scrypt$abc$8$1$c2FsdA==$aGFzaA==',
      'scrypt$16384$8$1$!!!$aGFzaA==',
      'scrypt$16384$8$1$c2FsdA==$!!!',
      '',
    ]) {
      await expect(verifyPassword('qualquer', bad)).resolves.toBe(false);
    }
  });

  it('DUMMY_PASSWORD_HASH nunca verifica senha comum', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('Demo123!', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPassword('password', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});
