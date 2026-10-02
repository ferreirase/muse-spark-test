import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type SqliteDb = Database.Database;

export interface OpenOptions {
  readonly?: boolean;
  timeoutMs?: number;
}

export function openDatabase(path: string, options: OpenOptions = {}): SqliteDb {
  if (path !== ":memory:" && !(options.readonly ?? false)) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path, {
    readonly: options.readonly ?? false,
    timeout: options.timeoutMs ?? 5000,
  });
  if (!(options.readonly ?? false)) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

export function closeDatabase(db: SqliteDb): void {
  if (db.open) db.close();
}
