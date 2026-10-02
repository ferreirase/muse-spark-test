import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeDatabase,
  openDatabase,
  type SqliteDb,
} from "../../src/db/connection.js";
import { migrate } from "../../src/db/migrate.js";
import { seed } from "../../src/db/seed.js";

export interface TestDb {
  db: SqliteDb;
  path: string;
  dir: string;
  cleanup: () => void;
}

export function openMigrated(path: string): SqliteDb {
  const db = openDatabase(path);
  migrate(db);
  return db;
}

export async function createTestDb(options: { seed?: boolean } = {}): Promise<TestDb> {
  const dir = mkdtempSync(join(tmpdir(), "bank-test-"));
  const path = join(dir, "bank.sqlite");
  const db = openDatabase(path);
  migrate(db);
  if (options.seed !== false) {
    await seed(db);
  }
  return {
    db,
    path,
    dir,
    cleanup: () => {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function reopen(path: string): SqliteDb {
  return openMigrated(path);
}

export function ledgerSum(
  db: SqliteDb,
  filter = "1 = 1",
): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM ledger_entries WHERE ${filter}`)
    .get() as { total: number };
  return row.total;
}

export function invariantTotal(db: SqliteDb): number {
  const balances = db
    .prepare("SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts")
    .get() as { total: number };
  const transit = db
    .prepare("SELECT COALESCE(SUM(in_transit_cents), 0) AS total FROM transfers")
    .get() as { total: number };
  return balances.total + transit.total;
}

export function countLedger(db: SqliteDb, transferId: string, type: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id = ? AND type = ?",
    )
    .get(transferId, type) as { n: number };
  return row.n;
}

export function steppingClock(
  startIso = "2026-10-01T00:00:00.000Z",
  stepMs = 1000,
) {
  let current = new Date(startIso).getTime();
  return {
    now: () => {
      const value = new Date(current);
      current += stepMs;
      return value;
    },
    advance: (ms: number) => {
      current += ms;
    },
  };
}
