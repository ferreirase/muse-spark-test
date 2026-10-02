import { describe, expect, it } from "vitest";
import {
  normalizeEmail,
  normalizeName,
  normalizeNickname,
  normalizeNote,
  validateAmountCents,
  validateIdempotencyKey,
  validateLimit,
  validatePassword,
} from "../../src/shared/validation.js";
import { AppError } from "../../src/shared/errors.js";

describe("normalizers", () => {
  it("trims and validates name", () => {
    expect(normalizeName("  Alice  ")).toBe("Alice");
    expect(() => normalizeName("A")).toThrow(AppError);
    expect(() => normalizeName("x".repeat(81))).toThrow(AppError);
  });

  it("normalizes email", () => {
    expect(normalizeEmail("  Alice@Demo.Local ")).toBe("alice@demo.local");
    expect(() => normalizeEmail("not-an-email")).toThrow(AppError);
  });

  it("does not trim password", () => {
    expect(validatePassword(" 12345678 ")).toBe(" 12345678 ");
    expect(() => validatePassword("short")).toThrow(AppError);
  });

  it("normalizes nickname", () => {
    expect(normalizeNickname("  Bruno ")).toBe("Bruno");
    expect(() => normalizeNickname("   ")).toThrow(AppError);
  });

  it("normalizes note to null when empty", () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote("  oi ")).toBe("oi");
    expect(() => normalizeNote("x".repeat(141))).toThrow(AppError);
  });

  it("validates amount bounds", () => {
    expect(validateAmountCents(1)).toBe(1);
    expect(validateAmountCents(100000000)).toBe(100000000);
    expect(() => validateAmountCents(0)).toThrow(AppError);
    expect(() => validateAmountCents(1.5)).toThrow(AppError);
    expect(() => validateAmountCents("100")).toThrow(AppError);
  });

  it("validates idempotency key", () => {
    expect(validateIdempotencyKey("alice-bruno-001")).toBe("alice-bruno-001");
    expect(() => validateIdempotencyKey("short")).toThrow(AppError);
    expect(() => validateIdempotencyKey("has space!!")).toThrow(AppError);
  });

  it("validates limit", () => {
    expect(validateLimit(undefined)).toBe(20);
    expect(validateLimit("50")).toBe(50);
    expect(() => validateLimit("0")).toThrow(AppError);
    expect(() => validateLimit("51")).toThrow(AppError);
  });
});
