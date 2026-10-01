// DTOs do contrato compartilhado §5 — autoridade para rotas e serialização.

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface Account {
  id: string;
  currency: 'BRL';
  balanceCents: number;
}

export interface AuthResult {
  user: User;
  account: Account;
}

export interface Balance {
  accountId: string;
  currency: 'BRL';
  balanceCents: number;
  updatedAt: string;
}

export interface Recipient {
  accountId: string;
  name: string;
}

export interface Contact {
  id: string;
  nickname: string;
  recipientAccountId: string;
  recipientName: string;
  createdAt: string;
}

export type TransferStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type TransferFailureCode = 'INSUFFICIENT_FUNDS' | 'CREDIT_FAILED' | null;

export interface Transfer {
  id: string;
  sourceAccountId: string;
  recipientAccountId: string;
  recipientName: string;
  amountCents: number;
  currency: 'BRL';
  note: string | null;
  status: TransferStatus;
  failureCode: TransferFailureCode;
  createdAt: string;
  updatedAt: string;
}

export interface TransferPage {
  items: Transfer[];
  nextCursor: string | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
  requestId: string;
}
