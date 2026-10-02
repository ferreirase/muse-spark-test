import { describe, expect, it } from "vitest";
import { isOriginAllowed } from "../../src/http/origin.js";
import {
  invalidCredentials,
  mapError,
  mapFastifyValidation,
  validationError,
} from "../../src/shared/errors.js";

describe("origin rule", () => {
  it("allows requests without Origin", () => {
    expect(isOriginAllowed("POST", undefined, "http://127.0.0.1:3000")).toBe(true);
  });

  it("allows GET from any origin", () => {
    expect(isOriginAllowed("GET", "http://evil.local", "http://127.0.0.1:3000")).toBe(
      true,
    );
  });

  it("allows configured origin on mutations", () => {
    expect(
      isOriginAllowed("POST", "http://127.0.0.1:3000", "http://127.0.0.1:3000"),
    ).toBe(true);
  });

  it("rejects foreign origin on mutations", () => {
    expect(
      isOriginAllowed("POST", "http://evil.local", "http://127.0.0.1:3000"),
    ).toBe(false);
  });
});

describe("error mapping", () => {
  it("maps AppError preserving code and status", () => {
    const mapped = mapError(invalidCredentials());
    expect(mapped).toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("maps validation details", () => {
    const mapped = mapError(validationError([{ field: "name", message: "bad" }]));
    expect(mapped.details).toEqual([{ field: "name", message: "bad" }]);
  });

  it("hides unknown errors behind INTERNAL_ERROR", () => {
    const mapped = mapError(new Error("boom: SELECT * FROM users"));
    expect(mapped).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    expect(mapped.message).not.toContain("SELECT");
  });

  it("maps Fastify/Ajv validation errors", () => {
    const mapped = mapFastifyValidation({
      validation: [
        { instancePath: "/amountCents", message: "must be integer" },
      ],
    });
    expect(mapped?.code).toBe("VALIDATION_ERROR");
    expect(mapped?.details?.[0]?.field).toBe("/amountCents");
  });

  it("returns null when no schema validation present", () => {
    expect(mapFastifyValidation({ statusCode: 500 })).toBeNull();
  });
});
