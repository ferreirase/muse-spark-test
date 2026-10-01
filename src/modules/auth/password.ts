import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const DEFAULT_N = 16384; // 2^14
const r = 8;
const p = 1;
const KEYLEN = 64;

export interface ScryptParams {
  N?: number;
}

export async function hashPassword(password: string, params: ScryptParams = {}): Promise<string> {
  const N = params.N ?? DEFAULT_N;
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * Verifica senha contra o formato `scrypt$N$r$p$saltB64$hashB64`.
 * Formato inválido/corrompido retorna false — nunca lança para o chamador.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const rr = Number(parts[2]);
  const pp = Number(parts[3]);
  if (!Number.isInteger(N) || N < 1 || !Number.isInteger(rr) || rr < 1 || !Number.isInteger(pp) || pp < 1) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64');
    expected = Buffer.from(parts[5]!, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, expected.length, { N, r: rr, p: pp, maxmem: 64 * 1024 * 1024 });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Hash fixo (senha aleatória desconhecida) usado quando o e-mail não existe,
 * para equalizar o tempo de resposta do signin. Nunca verifica senha comum.
 */
export const DUMMY_PASSWORD_HASH: string = await hashPassword(
  randomBytes(24).toString('base64url'),
  { N: DEFAULT_N },
);
