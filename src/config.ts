import { existsSync } from "node:fs";

export function loadEnvFileIfPresent(path = ".env"): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

export interface AppConfig {
  host: string;
  port: number;
  databasePath: string;
  frontendOrigin: string;
  cookieSecure: boolean;
  logLevel: string;
  workerPollIntervalMs: number;
  enableTestControls: boolean;
  testControlToken: string;
}

export class ConfigError extends Error {
  constructor(issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

const LOG_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

function parseBoolean(
  raw: string,
  field: string,
  issues: string[],
): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  issues.push(`${field} must be "true" or "false", got "${raw}"`);
  return false;
}

function parsePort(raw: string, field: string, issues: string[]): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    issues.push(`${field} must be an integer between 1 and 65535`);
    return 0;
  }
  return value;
}

function parsePositiveInt(raw: string, field: string, issues: string[]): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    issues.push(`${field} must be a positive integer`);
    return 0;
  }
  return value;
}

function parseOrigin(raw: string, field: string, issues: string[]): string {
  const value = raw.trim();
  if (value === "") {
    issues.push(`${field} must not be empty`);
    return "";
  }
  try {
    const url = new URL(value);
    if (url.origin !== value) {
      issues.push(`${field} must be an origin without path, query or trailing slash`);
      return "";
    }
    return url.origin;
  } catch {
    issues.push(`${field} must be a valid origin (e.g. http://127.0.0.1:3000)`);
    return "";
  }
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const issues: string[] = [];

  const host = (env.HOST ?? "127.0.0.1").trim();
  if (host === "") issues.push("HOST must not be empty");

  const port = parsePort(env.PORT ?? "3001", "PORT", issues);

  const databasePath = (env.DATABASE_PATH ?? "./data/bank.sqlite").trim();
  if (databasePath === "") {
    issues.push("DATABASE_PATH must not be empty");
  } else if (databasePath === ":memory:") {
    issues.push("DATABASE_PATH must be a file path; ':memory:' is not allowed");
  }

  const frontendOrigin = parseOrigin(
    env.FRONTEND_ORIGIN ?? "http://127.0.0.1:3000",
    "FRONTEND_ORIGIN",
    issues,
  );

  const cookieSecure = parseBoolean(
    env.COOKIE_SECURE ?? "false",
    "COOKIE_SECURE",
    issues,
  );

  const logLevel = (env.LOG_LEVEL ?? "info").trim().toLowerCase();
  if (!LOG_LEVELS.has(logLevel)) {
    issues.push(`LOG_LEVEL must be one of ${[...LOG_LEVELS].join(", ")}`);
  }

  const workerPollIntervalMs = parsePositiveInt(
    env.WORKER_POLL_INTERVAL_MS ?? "200",
    "WORKER_POLL_INTERVAL_MS",
    issues,
  );

  const enableTestControls = parseBoolean(
    env.ENABLE_TEST_CONTROLS ?? "false",
    "ENABLE_TEST_CONTROLS",
    issues,
  );

  const testControlToken = (env.TEST_CONTROL_TOKEN ?? "").trim();
  if (enableTestControls && testControlToken.length < 16) {
    issues.push(
      "TEST_CONTROL_TOKEN must have at least 16 characters when ENABLE_TEST_CONTROLS=true",
    );
  }

  if (issues.length > 0) throw new ConfigError(issues);

  return {
    host,
    port,
    databasePath,
    frontendOrigin,
    cookieSecure,
    logLevel,
    workerPollIntervalMs,
    enableTestControls,
    testControlToken,
  };
}
