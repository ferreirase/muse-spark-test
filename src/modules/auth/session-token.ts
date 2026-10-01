import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de sessão: 32 bytes (256 bits) de entropia em base64url (43 chars). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 é aceitável aqui (diferente de senha): o token tem 256 bits de
 * aleatoriedade criptográfica, inviabilizando brute force do hash → token.
 * O banco nunca guarda o token em claro.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
