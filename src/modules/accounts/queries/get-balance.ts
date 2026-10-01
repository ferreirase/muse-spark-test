import type Database from 'better-sqlite3';
import type { Balance } from '../../../shared/dto.js';

/**
 * Query GetBalance (leitura pura): saldo disponível atual — a coluna
 * balance_cents já desconta débitos em processamento (PRD B03).
 */
export function getBalance(readDb: Database.Database, accountId: string): Balance | null {
  const row = readDb
    .prepare('SELECT id, balance_cents, updated_at FROM accounts WHERE id=?')
    .get(accountId) as { id: string; balance_cents: number; updated_at: string } | undefined;
  if (!row) return null;
  return { accountId: row.id, currency: 'BRL', balanceCents: row.balance_cents, updatedAt: row.updated_at };
}
