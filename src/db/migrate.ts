import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Diretório de migrações relativo a este módulo: funciona em dev (src/db/)
 * e em prod (dist/db/) desde que os .sql sejam copiados no build (postbuild).
 */
export const migrationsDir: string = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations');

export function migrate(db: Database.Database, dir: string = migrationsDir): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version),
  );

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const apply = db.transaction((version: string, sql: string, now: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, now);
  });

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    apply.immediate(version, sql, new Date().toISOString());
  }
}
