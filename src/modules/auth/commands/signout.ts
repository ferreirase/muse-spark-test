import type Database from 'better-sqlite3';
import { revokeSession } from '../session-repository.js';

export interface SignoutDeps {
  db: Database.Database;
  now: Date;
}

/** Comando Signout: revoga a sessão se existir; sempre idempotente. */
export function signout(deps: SignoutDeps, token: string | undefined): void {
  if (token) revokeSession(deps.db, token, deps.now);
}
