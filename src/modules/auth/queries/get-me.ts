import type { SqliteDb } from "../../../db/connection.js";
import type { AuthResultDto } from "../../../shared/dto.js";
import {
  findAccountByUserId,
  findUserById,
} from "../repositories.js";
import { toAccountDto, toUserDto } from "../mappers.js";

export function getMe(db: SqliteDb, userId: string): AuthResultDto | undefined {
  const user = findUserById(db, userId);
  if (!user) return undefined;
  const account = findAccountByUserId(db, userId);
  if (!account) return undefined;
  return {
    user: toUserDto(user),
    account: toAccountDto(account),
  };
}
