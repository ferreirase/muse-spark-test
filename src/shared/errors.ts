export type ErrorDetail = { field: string; message: string };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  requestId: string;
}

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_ALREADY_EXISTS"
  | "RECIPIENT_NOT_FOUND"
  | "SELF_RECIPIENT"
  | "CONTACT_ALREADY_EXISTS"
  | "SELF_TRANSFER"
  | "IDEMPOTENCY_CONFLICT"
  | "TRANSFER_NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "The request body or parameters are invalid.",
  UNAUTHENTICATED: "Authentication is required.",
  INVALID_CREDENTIALS: "Invalid e-mail or password.",
  EMAIL_ALREADY_EXISTS: "This e-mail is already registered.",
  RECIPIENT_NOT_FOUND: "Recipient account was not found.",
  SELF_RECIPIENT: "You cannot use your own account as a recipient.",
  CONTACT_ALREADY_EXISTS: "This recipient is already saved as a contact.",
  SELF_TRANSFER: "You cannot transfer money to your own account.",
  IDEMPOTENCY_CONFLICT:
    "This Idempotency-Key was already used with a different payload.",
  TRANSFER_NOT_FOUND: "Transfer was not found.",
  ORIGIN_NOT_ALLOWED: "The request origin is not allowed.",
  FORBIDDEN: "A valid test control token is required.",
  INTERNAL_ERROR: "An unexpected internal error occurred.",
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ErrorDetail[];

  constructor(
    code: ErrorCode,
    status: number,
    message?: string,
    details?: ErrorDetail[],
  ) {
    super(message ?? DEFAULT_MESSAGE[code]);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function validationError(details: ErrorDetail[]): AppError {
  return new AppError("VALIDATION_ERROR", 400, undefined, details);
}

export function unauthenticated(): AppError {
  return new AppError("UNAUTHENTICATED", 401);
}

export function invalidCredentials(): AppError {
  return new AppError("INVALID_CREDENTIALS", 401);
}

export function emailAlreadyExists(): AppError {
  return new AppError("EMAIL_ALREADY_EXISTS", 409);
}

export function recipientNotFound(): AppError {
  return new AppError("RECIPIENT_NOT_FOUND", 404);
}

export function selfRecipient(): AppError {
  return new AppError("SELF_RECIPIENT", 422);
}

export function contactAlreadyExists(): AppError {
  return new AppError("CONTACT_ALREADY_EXISTS", 409);
}

export function selfTransfer(): AppError {
  return new AppError("SELF_TRANSFER", 422);
}

export function idempotencyConflict(): AppError {
  return new AppError("IDEMPOTENCY_CONFLICT", 409);
}

export function transferNotFound(): AppError {
  return new AppError("TRANSFER_NOT_FOUND", 404);
}

export function originNotAllowed(): AppError {
  return new AppError("ORIGIN_NOT_ALLOWED", 403);
}

export function internalError(): AppError {
  return new AppError("INTERNAL_ERROR", 500);
}

export interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
}

export function mapError(error: unknown): MappedError {
  if (error instanceof AppError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: DEFAULT_MESSAGE.INTERNAL_ERROR,
  };
}

export interface FastifyLikeError {
  code?: unknown;
  validation?: unknown;
  statusCode?: unknown;
}

export function mapFastifyValidation(error: FastifyLikeError): AppError | null {
  if (error.validation === undefined) return null;
  const details = normalizeAjvDetails(error.validation);
  return validationError(details.length > 0 ? details : [
    { field: "_", message: DEFAULT_MESSAGE.VALIDATION_ERROR },
  ]);
}

function normalizeAjvDetails(validation: unknown): ErrorDetail[] {
  if (!Array.isArray(validation)) return [];
  return validation.map((item) => {
    const record = item as Record<string, unknown>;
    const instancePath =
      typeof record.instancePath === "string" ? record.instancePath : "";
    const message =
      typeof record.message === "string"
        ? record.message
        : "invalid value";
    return { field: instancePath === "" ? "_" : instancePath, message };
  });
}
