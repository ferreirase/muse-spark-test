import type { AppConfig } from "./config.js";
import type { SqliteDb } from "./db/connection.js";
import type { Clock } from "./shared/clock.js";

export interface AppDeps {
  db: SqliteDb;
  config: AppConfig;
  clock: Clock;
  generateId?: () => string;
}
