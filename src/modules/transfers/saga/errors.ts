export class InsufficientFundsError extends Error {
  constructor() {
    super("insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

export class CreditFailedError extends Error {
  constructor(message = "credit failed") {
    super(message);
    this.name = "CreditFailedError";
  }
}

export class TransferNotFoundError extends Error {
  constructor(id: string) {
    super(`transfer not found: ${id}`);
    this.name = "TransferNotFoundError";
  }
}
