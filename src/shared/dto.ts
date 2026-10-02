export type Currency = "BRL";
export type TransferStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";
export type FailureCode = "INSUFFICIENT_FUNDS" | "CREDIT_FAILED";

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AccountDto {
  id: string;
  currency: Currency;
  balanceCents: number;
}

export interface AuthResultDto {
  user: UserDto;
  account: AccountDto;
}

export interface BalanceDto {
  accountId: string;
  currency: Currency;
  balanceCents: number;
  updatedAt: string;
}

export interface RecipientDto {
  accountId: string;
  name: string;
}

export interface ContactDto {
  id: string;
  nickname: string;
  recipientAccountId: string;
  recipientName: string;
  createdAt: string;
}

export interface TransferDto {
  id: string;
  sourceAccountId: string;
  recipientAccountId: string;
  recipientName: string;
  amountCents: number;
  currency: Currency;
  note: string | null;
  status: TransferStatus;
  failureCode: FailureCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransferPageDto {
  items: TransferDto[];
  nextCursor: string | null;
}

export interface ContactListDto {
  items: ContactDto[];
}
