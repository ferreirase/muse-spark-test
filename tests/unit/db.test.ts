import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, type SqliteDb } from "../../src/db/connection.js";
import { appliedVersions, migrate } from "../../src/db/migrate.js";
import { reset } from "../../src/db/reset.js";
import { createTestDb, type TestDb } from "./helpers.js";

describe("openDatabase + migrate", () => {
  it("applies pragmas", () => {
    const db = openDatabase(":memory:");
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.pragma("busy_timeout", { simple: true })).toBeGreaterThan(0);
    expect(String(db.pragma("journal_mode", { simple: true })).toLowerCase()).toBe(
      "memory",
    );
    closeDatabase(db);
  });

  it("is idempotent and orders migrations by file name", () => {
    const dir = mkdtempSync(join(tmpdir(), "bank-mig-"));
    try {
      writeFileSync(join(dir, "001_a.sql"), "CREATE TABLE a (id INTEGER);");
      writeFileSync(join(dir, "002_b.sql"), "CREATE TABLE b (id INTEGER);");
      const db = openDatabase(join(dir, "db.sqlite"));
      const first = migrate(db, { dir });
      expect(first.map((m) => m.version)).toEqual([1, 2]);
      const second = migrate(db, { dir });
      expect(second).toEqual([]);
      expect(appliedVersions(db)).toEqual([1, 2]);
      closeDatabase(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a failing migration without recording the version", () => {
    const dir = mkdtempSync(join(tmpdir(), "bank-mig-"));
    try {
      writeFileSync(join(dir, "001_ok.sql"), "CREATE TABLE ok (id INTEGER);");
      writeFileSync(join(dir, "002_bad.sql"), "THIS IS NOT SQL;");
      const db = openDatabase(join(dir, "db.sqlite"));
      expect(() => migrate(db, { dir })).toThrow();
      expect(appliedVersions(db)).toEqual([1]);
      closeDatabase(db);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("schema constraints", () => {
  let ctx: TestDb;
  let db: SqliteDb;

  beforeEach(async () => {
    ctx = await createTestDb();
    db = ctx.db;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function createTransfer(id: string, key: string, source = "acc-alice", target = "acc-bruno") {
    db.prepare(
      `INSERT INTO transfers
         (id, source_account_id, recipient_account_id, amount_cents, note, status,
          failure_code, saga_step, in_transit_cents, attempts, last_error,
          idempotency_key, payload_fingerprint, created_at, updated_at)
       VALUES (?, ?, ?, 1000, NULL, 'PENDING', NULL, 'CREATED', 0, 0, NULL, ?, 'fp', '2026-01-01', '2026-01-01')`,
    ).run(id, source, target, key);
  }

  function ledger(id: string, transferId: string, account: string, type: string, amount: number) {
    db.prepare(
      `INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at)
       VALUES (?, ?, ?, ?, ?, '2026-01-01')`,
    ).run(id, transferId, account, type, amount);
  }

  it("rejects negative or non-integer balances", () => {
    expect(() =>
      db.prepare("UPDATE accounts SET balance_cents = -1 WHERE id = 'acc-alice'").run(),
    ).toThrow();
    expect(() =>
      db.prepare("UPDATE accounts SET balance_cents = 1.5 WHERE id = 'acc-alice'").run(),
    ).toThrow();
  });

  it("enforces foreign keys", () => {
    expect(() =>
      db.prepare(
        "INSERT INTO accounts (id, user_id, currency, balance_cents, updated_at) VALUES ('x','ghost','BRL',0,'t')",
      ).run(),
    ).toThrow();
  });

  it("enforces idempotency key uniqueness per source account", () => {
    createTransfer("t1", "same-key-01");
    expect(() => createTransfer("t2", "same-key-01")).toThrow();
  });

  it("allows at most one ledger entry per transfer step", () => {
    createTransfer("t1", "key-00000001");
    ledger("l1", "t1", "acc-alice", "DEBIT", -1000);
    expect(() => ledger("l2", "t1", "acc-alice", "DEBIT", -500)).toThrow();
  });

  it("forbids CREDIT/COMPENSATION without a prior DEBIT", () => {
    createTransfer("t1", "key-00000002");
    expect(() => ledger("l1", "t1", "acc-bruno", "CREDIT", 1000)).toThrow();
  });

  it("forbids COMPENSATION after CREDIT and vice-versa", () => {
    createTransfer("t1", "key-00000003");
    ledger("l1", "t1", "acc-alice", "DEBIT", -1000);
    ledger("l2", "t1", "acc-bruno", "CREDIT", 1000);
    expect(() => ledger("l3", "t1", "acc-alice", "COMPENSATION", 1000)).toThrow();
  });

  it("keeps ledger_entries append-only", () => {
    createTransfer("t1", "key-00000004");
    ledger("l1", "t1", "acc-alice", "DEBIT", -1000);
    expect(() =>
      db.prepare("UPDATE ledger_entries SET amount_cents = 0 WHERE id = 'l1'").run(),
    ).toThrow();
    expect(() =>
      db.prepare("DELETE FROM ledger_entries WHERE id = 'l1'").run(),
    ).toThrow();
  });

  it("allows reset to clear the ledger through the guard", async () => {
    createTransfer("t1", "key-00000005");
    ledger("l1", "t1", "acc-alice", "DEBIT", -1000);
    await reset(db);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM ledger_entries")
      .get() as { n: number };
    expect(rows.n).toBe(0);
    const guard = db
      .prepare("SELECT COUNT(*) AS n FROM ledger_reset_guard")
      .get() as { n: number };
    expect(guard.n).toBe(0);
  });
});
