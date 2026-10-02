import type { SqliteDb } from "../../../db/connection.js";
import type { BalanceDto } from "../../../shared/dto.js";
import { findAccountById } from "../../auth/repositories.js";

export function getBalance(
  db: SqliteDb,
  accountId: string,
): BalanceDto | undefined {
  const account = findAccountById(db, accountId);
  if (!account) return undefined;
  return {
    accountId: account.id,
    currency: "BRL",
    balanceCents: account.balance_cents,
    updatedAt: account.updated_at,
  };
}
