import { AppError, type ErrorDetail } from "./errors.js";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../modules/auth/password.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

export const AMOUNT_MIN_CENTS = 1;
export const AMOUNT_MAX_CENTS = 100_000_000;

export function invalid(field: string, message: string): AppError {
  return new AppError("VALIDATION_ERROR", 400, undefined, [{ field, message }]);
}

export function normalizeName(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("name", "name must be a string");
  const value = raw.trim();
  if (value.length < 2 || value.length > 80) {
    throw invalid("name", "name must have between 2 and 80 characters after trim");
  }
  return value;
}

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== "string") throw invalid("email", "email must be a string");
  const value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 254) {
    throw invalid("email", "email must have at most 254 characters");
  }
  if (!EMAIL_RE.test(value)) {
    throw invalid("email", "email must be a valid e-mail address");
  }
  return value;
}

export function validatePassword(raw: unknown): string {
  if (typeof raw !== "string") {
    throw invalid("password", "password must be a string");
  }
  if (raw.length < MIN_PASSWORD_LENGTH || raw.length > MAX_PASSWORD_LENGTH) {
    throw invalid(
      "password",
      `password must have between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
    );
  }
  return raw;
}

export function normalizeNickname(raw: unknown): string {
  if (typeof raw !== "string") {
    throw invalid("nickname", "nickname must be a string");
  }
  const value = raw.trim();
  if (value.length < 1 || value.length > 60) {
    throw invalid("nickname", "nickname must have between 1 and 60 characters after trim");
  }
  return value;
}

export function normalizeNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw invalid("note", "note must be a string or null");
  }
  const value = raw.trim();
  if (value.length === 0) return null;
  if (value.length > 140) {
    throw invalid("note", "note must have at most 140 characters after trim");
  }
  return value;
}

export function validateAmountCents(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw invalid("amountCents", "amountCents must be an integer number of cents");
  }
  if (raw < AMOUNT_MIN_CENTS || raw > AMOUNT_MAX_CENTS) {
    throw invalid(
      "amountCents",
      `amountCents must be between ${AMOUNT_MIN_CENTS} and ${AMOUNT_MAX_CENTS}`,
    );
  }
  return raw;
}

export function validateAccountId(raw: unknown, field = "recipientAccountId"): string {
  if (typeof raw !== "string") {
    throw invalid(field, `${field} must be a string`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw invalid(field, `${field} must not be empty`);
  }
  return value;
}

export function validateIdempotencyKey(raw: unknown): string {
  if (typeof raw !== "string") {
    throw invalid(
      "Idempotency-Key",
      "Idempotency-Key header is required and must be a string",
    );
  }
  if (!IDEMPOTENCY_KEY_RE.test(raw)) {
    throw invalid(
      "Idempotency-Key",
      "Idempotency-Key must match ^[A-Za-z0-9._:-]{8,128}$",
    );
  }
  return raw;
}

export function validateLimit(raw: unknown): number {
  if (raw === undefined) return 20;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw invalid("limit", "limit must be an integer between 1 and 50");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw invalid("limit", "limit must be an integer between 1 and 50");
  }
  return value;
}

export function joinDetails(...errors: ErrorDetail[]): ErrorDetail[] {
  return errors;
}
