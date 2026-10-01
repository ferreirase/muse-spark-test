import { errors } from './errors.js';

function bad(field: string, message: string): never {
  throw errors.validation([{ field, message }]);
}

const asString = (v: unknown, field: string): string => {
  if (typeof v !== 'string') bad(field, 'deve ser string');
  return v;
};

/** Nome: trim, 2–80 caracteres (contrato §2). */
export function normalizeName(value: unknown): string {
  const s = asString(value, 'name').trim();
  if (s.length < 2 || s.length > 80) bad('name', 'deve ter entre 2 e 80 caracteres após trim');
  return s;
}

/** E-mail: trim + lowercase, formato simples, ≤254 (contrato §2). */
export function normalizeEmail(value: unknown): string {
  const s = asString(value, 'email').trim().toLowerCase();
  if (s.length === 0 || s.length > 254) bad('email', 'deve ter até 254 caracteres');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('email', 'formato de e-mail inválido');
  return s;
}

/** Senha: 8–72 caracteres, SEM trim silencioso (contrato §2). */
export function checkPassword(value: unknown): string {
  const s = asString(value, 'password');
  if (s.length < 8 || s.length > 72) bad('password', 'deve ter entre 8 e 72 caracteres');
  return s;
}

/** Apelido de contato: trim, 1–60 (contrato §2). */
export function normalizeNickname(value: unknown): string {
  const s = asString(value, 'nickname').trim();
  if (s.length < 1 || s.length > 60) bad('nickname', 'deve ter entre 1 e 60 caracteres após trim');
  return s;
}

/** Nota de transferência: opcional; trim; vazia → null; ≤140 (contrato §2). */
export function normalizeNote(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = asString(value, 'note').trim();
  if (s.length === 0) return null;
  if (s.length > 140) bad('note', 'deve ter até 140 caracteres após trim');
  return s;
}

/** limit de paginação: inteiro 1–50, default 20 (contrato §6). */
export function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 20;
  const raw = asString(value, 'limit');
  if (!/^[0-9]{1,3}$/.test(raw)) bad('limit', 'deve ser inteiro entre 1 e 50');
  const n = Number(raw);
  if (n < 1 || n > 50) bad('limit', 'deve ser inteiro entre 1 e 50');
  return n;
}

/** Idempotency-Key: ^[A-Za-z0-9._:-]{8,128}$ (contrato §6). */
export function checkIdempotencyKey(value: unknown): string {
  const s = asString(value, 'idempotency-key');
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(s)) {
    bad('idempotency-key', 'deve ter 8–128 caracteres ASCII (letras, números, . _ : -)');
  }
  return s;
}

/** ID opaco não vazio. */
export function checkId(value: unknown, field: string): string {
  const s = asString(value, field);
  if (s.length === 0) bad(field, 'não pode ser vazio');
  return s;
}
