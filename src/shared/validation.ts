import { validationError } from './errors.js';

/** Normalizadores puros de domínio (contrato §2). Lançam validationError. */

export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw validationError([{ field: 'name', message: 'nome deve ser texto' }]);
  }
  const name = raw.trim();
  if (name.length < 2 || name.length > 80) {
    throw validationError([{ field: 'name', message: 'nome deve ter entre 2 e 80 caracteres' }]);
  }
  return name;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw validationError([{ field: 'email', message: 'e-mail deve ser texto' }]);
  }
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) {
    throw validationError([{ field: 'email', message: 'e-mail inválido' }]);
  }
  return email;
}

/** Senha: 8–72 caracteres, SEM trim — preservada byte a byte. */
export function checkPassword(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw validationError([{ field: 'password', message: 'senha deve ser texto' }]);
  }
  if (raw.length < 8 || raw.length > 72) {
    throw validationError([{ field: 'password', message: 'senha deve ter entre 8 e 72 caracteres' }]);
  }
  return raw;
}

export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw validationError([{ field: 'nickname', message: 'apelido deve ser texto' }]);
  }
  const nickname = raw.trim();
  if (nickname.length < 1 || nickname.length > 60) {
    throw validationError([{ field: 'nickname', message: 'apelido deve ter entre 1 e 60 caracteres' }]);
  }
  return nickname;
}

/** Nota opcional: ausente/vazia após trim → null; até 140 chars. */
export function normalizeNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw validationError([{ field: 'note', message: 'nota deve ser texto' }]);
  }
  const note = raw.trim();
  if (note === '') return null;
  if (note.length > 140) {
    throw validationError([{ field: 'note', message: 'nota deve ter até 140 caracteres' }]);
  }
  return note;
}

export function checkAmountCents(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw validationError([{ field: 'amountCents', message: 'amountCents deve ser inteiro' }]);
  }
  if (raw < 1 || raw > 100000000) {
    throw validationError([
      { field: 'amountCents', message: 'amountCents deve estar entre 1 e 100000000' },
    ]);
  }
  return raw;
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export function checkIdempotencyKey(raw: unknown): string {
  if (typeof raw !== 'string' || !IDEMPOTENCY_KEY_RE.test(raw)) {
    throw validationError([
      {
        field: 'idempotency-key',
        message: 'Idempotency-Key deve ter 8–128 chars [A-Za-z0-9._:-]',
      },
    ]);
  }
  return raw;
}

/** limit da querystring: ausente → 20; inteiro 1–50. */
export function parseLimit(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 20;
  const s = String(raw);
  if (!/^[0-9]{1,3}$/.test(s)) {
    throw validationError([{ field: 'limit', message: 'limit deve ser inteiro entre 1 e 50' }]);
  }
  const n = Number(s);
  if (n < 1 || n > 50) {
    throw validationError([{ field: 'limit', message: 'limit deve ser inteiro entre 1 e 50' }]);
  }
  return n;
}
