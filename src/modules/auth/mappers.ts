import type { AccountRow, UserRow } from "./repositories.js";
import type { AccountDto, UserDto } from "../../shared/dto.js";

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

export function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    currency: "BRL",
    balanceCents: row.balance_cents,
  };
}
