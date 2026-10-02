import { describe, expect, it } from "vitest";
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from "../../src/modules/auth/password.js";
import {
  generateSessionToken,
  hashSessionToken,
  sessionTokensEqual,
} from "../../src/modules/auth/session-token.js";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const stored = await hashPassword("Demo123!");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("Demo123!");
    expect(await verifyPassword("Demo123!", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("produces a different salt per hash", async () => {
    const a = await hashPassword("Demo123!");
    const b = await hashPassword("Demo123!");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1$2$3$4")).toBe(false);
  });

  it("uses the dummy hash to equalize unknown-user timing", async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("anything", DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe("session tokens", () => {
  it("generates random opaque tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(43);
    expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true);
  });

  it("hashes deterministically and compares safely", () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(sessionTokensEqual("abc", "abc")).toBe(true);
    expect(sessionTokensEqual("abc", "abd")).toBe(false);
    expect(sessionTokensEqual("abc", "abcd")).toBe(false);
  });
});
