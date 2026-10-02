import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/config.js";

describe("parseConfig", () => {
  it("applies defaults", () => {
    const config = parseConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3001);
    expect(config.databasePath).toBe("./data/bank.sqlite");
    expect(config.frontendOrigin).toBe("http://127.0.0.1:3000");
    expect(config.enableTestControls).toBe(false);
  });

  it("parses values from env", () => {
    const config = parseConfig({
      HOST: "0.0.0.0",
      PORT: "8080",
      DATABASE_PATH: "/tmp/x.sqlite",
      FRONTEND_ORIGIN: "http://localhost:3000",
      COOKIE_SECURE: "true",
      WORKER_POLL_INTERVAL_MS: "50",
      ENABLE_TEST_CONTROLS: "true",
      TEST_CONTROL_TOKEN: "unit-test-token-1234",
    });
    expect(config.port).toBe(8080);
    expect(config.cookieSecure).toBe(true);
    expect(config.workerPollIntervalMs).toBe(50);
    expect(config.enableTestControls).toBe(true);
  });

  it("rejects :memory:", () => {
    expect(() => parseConfig({ DATABASE_PATH: ":memory:" })).toThrow(/memory/);
  });

  it("requires token when test controls enabled", () => {
    expect(() => parseConfig({ ENABLE_TEST_CONTROLS: "true" })).toThrow(
      /TEST_CONTROL_TOKEN/,
    );
  });

  it("rejects invalid port", () => {
    expect(() => parseConfig({ PORT: "abc" })).toThrow(/PORT/);
  });

  it("rejects origin with path", () => {
    expect(() => parseConfig({ FRONTEND_ORIGIN: "http://x.local/a" })).toThrow(
      /FRONTEND_ORIGIN/,
    );
  });

  it("requires a token with at least 16 characters", () => {
    expect(() =>
      parseConfig({ ENABLE_TEST_CONTROLS: "true", TEST_CONTROL_TOKEN: "short" }),
    ).toThrow(/TEST_CONTROL_TOKEN/);
  });

  it("reports all invalid variables together", () => {
    try {
      parseConfig({ PORT: "abc", COOKIE_SECURE: "yes" });
      throw new Error("expected ConfigError");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("PORT");
      expect(message).toContain("COOKIE_SECURE");
    }
  });
});
