import type { SqliteDb } from "./connection.js";
import { seed, type SeedDeps } from "./seed.js";

export const OPERATIONAL_TABLES = [
  "test_faults",
  "ledger_entries",
  "jobs",
  "transfers",
  "contacts",
  "sessions",
  "accounts",
  "users",
] as const;

export async function reset(db: SqliteDb, deps: SeedDeps = {}): Promise<void> {
  const run = db.transaction(() => {
    db.prepare("INSERT INTO ledger_reset_guard (id) VALUES (1)").run();
    try {
      for (const table of OPERATIONAL_TABLES) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
    } finally {
      db.prepare("DELETE FROM ledger_reset_guard").run();
    }
  });
  run.immediate();
  await seed(db, deps);
}
