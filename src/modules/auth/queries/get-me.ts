import type { Db } from '../../../db/connection.js';
import type { AuthResult } from '../../../shared/dto.js';
import { AppError } from '../../../shared/errors.js';

/** Query GetMe: só SELECT. Retorna AuthResult do usuário. */
export function getMe(readDb: Db, userId: string): AuthResult {
  const row = readDb
    .prepare(
      `SELECT u.id AS userId, u.name AS userName, u.email AS userEmail, u.created_at AS userCreatedAt,
              a.id AS accountId, a.balance_cents AS balanceCents
       FROM users u JOIN accounts a ON a.user_id = u.id
       WHERE u.id = ?`,
    )
    .get(userId) as
    | {
        userId: string;
        userName: string;
        userEmail: string;
        userCreatedAt: string;
        accountId: string;
        balanceCents: number;
      }
    | undefined;
  if (row === undefined) {
    throw new AppError('UNAUTHENTICATED', 401, 'Sessão ausente, expirada ou revogada');
  }
  return {
    user: { id: row.userId, name: row.userName, email: row.userEmail, createdAt: row.userCreatedAt },
    account: { id: row.accountId, currency: 'BRL', balanceCents: row.balanceCents },
  };
}
