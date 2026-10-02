import { describe, expect, it } from "vitest";
import {
  decodeTransferCursor,
  encodeTransferCursor,
} from "../../src/modules/transfers/queries/cursor.js";
import { payloadFingerprint } from "../../src/modules/transfers/fingerprint.js";
import { AppError } from "../../src/shared/errors.js";

describe("transfer cursor", () => {
  it("round-trips createdAt and id", () => {
    const cursor = encodeTransferCursor(
      "2026-10-01T19:00:00.000Z",
      "transfer-1",
    );
    expect(decodeTransferCursor(cursor)).toEqual({
      createdAt: "2026-10-01T19:00:00.000Z",
      id: "transfer-1",
    });
  });

  it("is opaque (not plain text)", () => {
    const cursor = encodeTransferCursor("2026-10-01T19:00:00.000Z", "x");
    expect(cursor).not.toContain("transfer");
  });

  it("rejects invalid cursors with VALIDATION_ERROR", () => {
    expect(() => decodeTransferCursor("not-a-cursor")).toThrow(AppError);
    expect(() => decodeTransferCursor("")).toThrow(AppError);
  });
});

describe("payload fingerprint", () => {
  const base = { recipientAccountId: "acc-bruno", amountCents: 100, note: null };

  it("is stable for identical payloads", () => {
    expect(payloadFingerprint(base)).toBe(payloadFingerprint({ ...base }));
  });

  it("changes when any field changes", () => {
    expect(payloadFingerprint(base)).not.toBe(
      payloadFingerprint({ ...base, amountCents: 101 }),
    );
    expect(payloadFingerprint(base)).not.toBe(
      payloadFingerprint({ ...base, note: "x" }),
    );
  });

  it("treats null and different note as distinct", () => {
    expect(payloadFingerprint(base)).not.toBe(
      payloadFingerprint({ ...base, recipientAccountId: "acc-carla" }),
    );
  });
});
