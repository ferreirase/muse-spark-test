import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const spec = JSON.parse(readFileSync(join(root, "openapi.json"), "utf8")) as {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
};

const EXPECTED: Array<[string, string]> = [
  ["/health", "get"],
  ["/v1/auth/signup", "post"],
  ["/v1/auth/signin", "post"],
  ["/v1/auth/signout", "post"],
  ["/v1/me", "get"],
  ["/v1/accounts/me/balance", "get"],
  ["/v1/recipients/{accountId}", "get"],
  ["/v1/contacts", "get"],
  ["/v1/contacts", "post"],
  ["/v1/transfers", "get"],
  ["/v1/transfers", "post"],
  ["/v1/transfers/{id}", "get"],
];

describe("openapi.json", () => {
  it("is OpenAPI 3.1", () => {
    expect(spec.openapi.startsWith("3.1")).toBe(true);
  });

  it("documents every normal route", () => {
    for (const [path, method] of EXPECTED) {
      expect(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it("keeps test controls out of the main spec", () => {
    expect(Object.keys(spec.paths).some((p) => p.startsWith("/__test"))).toBe(false);
  });

  it("documents the session cookie and idempotency header", () => {
    const text = JSON.stringify(spec);
    expect(text).toContain("bank_session");
    expect(text).toContain("Idempotency-Key");
  });
});
