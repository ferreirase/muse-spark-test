import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import type { Db } from './connection.js';

function defaultMigrationsDir(): string {
  // src/db/migrate.ts em dev; dist/db/migrate.js em prod (migrações copiadas por postbuild).
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'migrations');
}

export function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Aplica migrações pendentes em ordem, uma vez cada. Idempotente. */
export function migrate(db: Db, dir: string = defaultMigrationsDir()): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
      (r) => r.version,
    ),
  );
  const appliedNow: string[] = [];
  for (const file of listMigrationFiles(dir)) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))").run(
        version,
      );
    });
    apply();
    appliedNow.push(version);
  }
  return appliedNow;
}

export function appliedVersions(db: Db): string[] {
  return (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: string;
    }[]
  ).map((r) => r.version);
}
