import { describe, expect, it } from "vitest";
import { retryAsync } from "../../src/modules/transfers/saga/retry.js";
import { isBusyError } from "../../src/shared/sqlite-errors.js";

function busyError(): Error & { code: string } {
  const error = new Error("database is locked") as Error & { code: string };
  error.code = "SQLITE_BUSY";
  return error;
}

describe("retryAsync", () => {
  it("returns immediately on success", async () => {
    let calls = 0;
    const result = await retryAsync(() => {
      calls += 1;
      return "ok";
    }, { attempts: 5, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries transient SQLITE_BUSY then succeeds", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await retryAsync(
      () => {
        calls += 1;
        if (calls < 3) throw busyError();
        return calls;
      },
      {
        attempts: 5,
        baseDelayMs: 25,
        sleep: async (ms) => {
          delays.push(ms);
        },
        jitter: () => 0,
      },
    );
    expect(result).toBe(3);
    expect(delays).toEqual([25, 50]);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      retryAsync(
        () => {
          calls += 1;
          throw new Error("boom");
        },
        { attempts: 5, baseDelayMs: 0, isRetryable: isBusyError },
      ),
    ).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  it("gives up after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      retryAsync(
        () => {
          calls += 1;
          throw busyError();
        },
        { attempts: 3, baseDelayMs: 0, sleep: async () => {}, jitter: () => 0 },
      ),
    ).rejects.toMatchObject({ code: "SQLITE_BUSY" });
    expect(calls).toBe(3);
  });
});
