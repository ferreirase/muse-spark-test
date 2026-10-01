import type { Db } from '../../../db/connection.js';
import type { Balance } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';

/** Query GetBalance: só SELECT. Saldo disponível = accounts.balance_cents. */
export function getBalance(readDb: Db, accountId: string): Balance {
  const row = readDb
    .prepare(`SELECT id, balance_cents AS balanceCents, updated_at AS updatedAt FROM accounts WHERE id = ?`)
    .get(accountId) as { id: string; balanceCents: number; updatedAt: string } | undefined;
  if (row === undefined) {
    throw new AppError('UNAUTHENTICATED', 401, 'Sessão ausente, expirada ou revogada');
  }
  return { accountId: row.id, currency: 'BRL', balanceCents: row.balanceCents, updatedAt: row.updatedAt };
}
