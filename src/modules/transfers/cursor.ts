import { errors } from '../../shared/errors.js';

export interface CursorPayload {
  createdAt: string;
  id: string;
}

/** Cursor opaco: base64url de JSON [createdAt, id]. */
export function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify([p.createdAt, p.id])).toString('base64url');
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Decodifica e valida; forma inválida → 400 VALIDATION_ERROR field cursor. */
export function decodeCursor(s: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
  } catch {
    throw errors.validation([{ field: 'cursor', message: 'cursor inválido' }]);
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') {
    throw errors.validation([{ field: 'cursor', message: 'cursor inválido' }]);
  }
  const [createdAt, id] = parsed as [string, string];
  if (!ISO_RE.test(createdAt) || Number.isNaN(Date.parse(createdAt)) || id.length === 0) {
    throw errors.validation([{ field: 'cursor', message: 'cursor inválido' }]);
  }
  return { createdAt, id };
}
