import type Database from 'better-sqlite3';
import type { AuthResult } from '../../../shared/dto.js';

/** Query GetMe (leitura pura): JOIN users+accounts → AuthResult. */
export function getMe(readDb: Database.Database, userId: string): AuthResult | null {
  const row = readDb
    .prepare(
      `SELECT u.id, u.name, u.email, u.created_at, a.id AS account_id, a.balance_cents
       FROM users u JOIN accounts a ON a.user_id = u.id
       WHERE u.id = ?`,
    )
    .get(userId) as
    | { id: string; name: string; email: string; created_at: string; account_id: string; balance_cents: number }
    | undefined;
  if (!row) return null;
  return {
    user: { id: row.id, name: row.name, email: row.email, createdAt: row.created_at },
    account: { id: row.account_id, currency: 'BRL', balanceCents: row.balance_cents },
  };
}
