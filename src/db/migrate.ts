import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteDb } from "./connection.js";

export interface Migration {
  version: number;
  name: string;
  filename: string;
  sql: string;
}

const MIGRATION_RE = /^(\d{3,})_([a-z0-9_]+)\.sql$/i;

function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "migrations");
}

export function loadMigrations(dir: string = defaultMigrationsDir()): Migration[] {
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql"));
  const migrations: Migration[] = [];
  for (const filename of files) {
    const match = MIGRATION_RE.exec(filename);
    if (!match) continue;
    migrations.push({
      version: Number(match[1]),
      name: match[2]!,
      filename,
      sql: readFileSync(join(dir, filename), "utf8"),
    });
  }
  migrations.sort((a, b) => a.version - b.version);
  return migrations;
}

function ensureMigrationsTable(db: SqliteDb): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at TEXT NOT NULL
     );`,
  );
}

export function appliedVersions(db: SqliteDb): number[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number }>;
  return rows.map((row) => row.version);
}

export function migrate(
  db: SqliteDb,
  options: { dir?: string; now?: () => string } = {},
): Migration[] {
  const now = options.now ?? (() => new Date().toISOString());
  const migrations = loadMigrations(options.dir);
  ensureMigrationsTable(db);
  const applied = new Set(appliedVersions(db));
  const executed: Migration[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, now());
    });
    run.immediate();
    executed.push(migration);
  }
  return executed;
}
