import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

const PREFIX = 'scrypt';
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_LEN = 16;

/** Hash de senha com scrypt + salt aleatório. Formato: scrypt$N$r$p$salB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = (await scryptAsync(password, salt, KEYLEN, { N, r: R, p: P })) as Buffer;
  return `${PREFIX}$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function safeFromBase64(s: string): Buffer | null {
  try {
    const buf = Buffer.from(s, 'base64');
    // Re-encode e compara para rejeitar alfabetos inválidos silenciosamente aceitos.
    if (buf.toString('base64') !== s.replace(/\s+/g, '')) {
      // Permite padding ausente? Buffer aceita; valida roundtrip frouxo:
      const re = Buffer.from(buf.toString('base64'), 'base64');
      if (!re.equals(buf)) return null;
    }
    return buf;
  } catch {
    return null;
  }
}

/** Verifica senha. Formato inválido → false (nunca lança). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 0 || r <= 0 || p <= 0 || n > 1 << 20) return false;
  const salt = safeFromBase64(saltB64);
  const expected = safeFromBase64(hashB64);
  if (salt === null || expected === null || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = (await scryptAsync(password, salt, expected.length, { N: n, r, p })) as Buffer;
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Hash fixo (senha desconhecida) para o signin comparar quando o e-mail
 * não existir, igualando o tempo de resposta e evitando enumeração.
 */
export const DUMMY_PASSWORD_HASH: string = await hashPassword(
  `dummy:${randomBytes(16).toString('hex')}`,
);
