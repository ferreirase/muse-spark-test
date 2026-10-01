import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de sessão: 32 bytes aleatórios em base64url (43 chars). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Hash SHA-256 hex do token para persistir no SQLite.
 * SHA-256 simples é aceitável aqui (diferente de senha): o token tem
 * 256 bits de entropia criptográfica, então dicionário/brute-force são inviáveis.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
