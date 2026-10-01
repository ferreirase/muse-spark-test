import { Buffer } from 'node:buffer';
import { validationError } from '../../shared/errors.js';

export interface PageCursor {
  createdAt: string;
  id: string;
}

/** Cursor opaco: base64url de JSON [createdAt, id]. */
export function encodeCursor(c: PageCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id]), 'utf8').toString('base64url');
}

/** Decodifica ou lança validationError field 'cursor'. */
export function decodeCursor(raw: unknown): PageCursor {
  const fail = (): never => {
    throw validationError([{ field: 'cursor', message: 'cursor inválido' }]);
  };
  if (typeof raw !== 'string' || raw === '') fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw as string, 'base64url').toString('utf8'));
  } catch {
    fail();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) fail();
  const [createdAtRaw, idRaw]: unknown[] = parsed as unknown[];
  if (typeof createdAtRaw !== 'string' || typeof idRaw !== 'string' || createdAtRaw === '' || idRaw === '') fail();
  const createdAt: string = createdAtRaw as string;
  const id: string = idRaw as string;
  if (Number.isNaN(Date.parse(createdAt))) fail();
  return { createdAt, id };
}
