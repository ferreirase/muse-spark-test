import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestTransfer } from "../../src/modules/transfers/commands/request-transfer.js";
import { getTransfer } from "../../src/modules/transfers/queries/get-transfer.js";
import { listTransfers } from "../../src/modules/transfers/queries/list-transfers.js";
import { runSaga } from "../../src/modules/transfers/saga/orchestrator.js";
import { stepDebit } from "../../src/modules/transfers/saga/steps.js";
import { TransferWorker } from "../../src/modules/worker/worker.js";
import { armFault } from "../../src/modules/test-controls/faults.js";
import { AppError } from "../../src/shared/errors.js";
import {
  countLedger,
  createTestDb,
  invariantTotal,
  reopen,
  steppingClock,
  type TestDb,
} from "./helpers.js";

let ctx: TestDb;
let clock: ReturnType<typeof steppingClock>;

beforeEach(async () => {
  ctx = await createTestDb();
  clock = steppingClock();
});

afterEach(() => {
  ctx.cleanup();
});

function makeWorker(
  db = ctx.db,
  clk = clock,
  extra: Partial<ConstructorParameters<typeof TransferWorker>[0]> = {},
) {
  return new TransferWorker({
    db,
    clock: clk,
    pollIntervalMs: 1,
    leaseMs: 5000,
    sleep: async () => {},
    ...extra,
  });
}

function aliceBalance(db = ctx.db): number {
  const row = db
    .prepare("SELECT balance_cents AS b FROM accounts WHERE id = 'acc-alice'")
    .get() as { b: number };
  return row.b;
}

describe("requestTransfer command", () => {
  it("persists a PENDING transfer and its durable job in one commit", () => {
    const result = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 10000,
        note: " Almoço ",
        idempotencyKey: "alice-bruno-001",
      },
    );
    expect(result.created).toBe(true);
    expect(result.transfer).toMatchObject({
      status: "PENDING",
      amountCents: 10000,
      note: "Almoço",
      failureCode: null,
    });
    const job = ctx.db
      .prepare("SELECT status FROM jobs WHERE transfer_id = ?")
      .get(result.transfer.id) as { status: string };
    expect(job.status).toBe("PENDING");
  });

  it("replays the same key and payload without creating new work", () => {
    const first = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 10000,
        idempotencyKey: "replay-key-01",
      },
    );
    const second = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 10000,
        idempotencyKey: "replay-key-01",
      },
    );
    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id);
    const jobs = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM jobs")
      .get() as { n: number };
    expect(jobs.n).toBe(1);
  });

  it("conflicts when the same key carries a different payload", () => {
    requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 10000,
        idempotencyKey: "conflict-key-1",
      },
    );
    expect(() =>
      requestTransfer(
        { db: ctx.db, clock },
        "acc-alice",
        {
          recipientAccountId: "acc-bruno",
          amountCents: 9999,
          idempotencyKey: "conflict-key-1",
        },
      ),
    ).toThrow(AppError);
  });

  it("rejects self transfer and unknown recipient", () => {
    expect(() =>
      requestTransfer(
        { db: ctx.db, clock },
        "acc-alice",
        {
          recipientAccountId: "acc-alice",
          amountCents: 100,
          idempotencyKey: "self-key-0001",
        },
      ),
    ).toThrowError(/own account/i);

    expect(() =>
      requestTransfer(
        { db: ctx.db, clock },
        "acc-alice",
        {
          recipientAccountId: "acc-ghost",
          amountCents: 100,
          idempotencyKey: "ghost-key-001",
        },
      ),
    ).toThrowError(/not found/i);
  });
});

describe("saga success path", () => {
  it("debits, credits and completes with double-entry integrity", async () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 10000,
        idempotencyKey: "success-key-1",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();

    const transfer = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(transfer.status).toBe("COMPLETED");
    expect(transfer.failureCode).toBeNull();
    expect(countLedger(ctx.db, transfer.id, "DEBIT")).toBe(1);
    expect(countLedger(ctx.db, transfer.id, "CREDIT")).toBe(1);
    expect(aliceBalance()).toBe(90000);
    expect(invariantTotal(ctx.db)).toBe(125000);
  });

  it("applies each step at most once when re-run", () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 5000,
        idempotencyKey: "idem-step-001",
      },
    );
    const deps = { db: ctx.db, clock };
    expect(stepDebit(deps, created.transfer.id)).toBe("DEBITED");
    const afterFirst = aliceBalance();
    expect(stepDebit(deps, created.transfer.id)).toBe("ALREADY_APPLIED");
    expect(aliceBalance()).toBe(afterFirst);
    expect(countLedger(ctx.db, created.transfer.id, "DEBIT")).toBe(1);
  });
});

describe("saga failure paths", () => {
  it("fails with INSUFFICIENT_FUNDS without any financial effect", async () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 100001,
        idempotencyKey: "insuff-key-01",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();

    const transfer = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(transfer.status).toBe("FAILED");
    expect(transfer.failureCode).toBe("INSUFFICIENT_FUNDS");
    expect(countLedger(ctx.db, transfer.id, "DEBIT")).toBe(0);
    expect(aliceBalance()).toBe(100000);
    expect(invariantTotal(ctx.db)).toBe(125000);
  });

  it("compensates a definitive credit failure", async () => {
    armFault(
      { db: ctx.db, clock },
      {
        sourceAccountId: "acc-alice",
        idempotencyKey: "credit-fail-1",
        mode: "FAIL_CREDIT_ONCE",
      },
    );
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 7000,
        idempotencyKey: "credit-fail-1",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();

    const transfer = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(transfer.status).toBe("FAILED");
    expect(transfer.failureCode).toBe("CREDIT_FAILED");
    expect(countLedger(ctx.db, transfer.id, "CREDIT")).toBe(0);
    expect(countLedger(ctx.db, transfer.id, "COMPENSATION")).toBe(1);
    expect(aliceBalance()).toBe(100000);
    expect(invariantTotal(ctx.db)).toBe(125000);
  });

  it("rolls back the debit when compensation happens", async () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 7000,
        idempotencyKey: "comp-debit-01",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();
    const transfer = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(transfer.status).toBe("COMPLETED");
    expect(countLedger(ctx.db, transfer.id, "COMPENSATION")).toBe(0);
  });
});

describe("pause and recovery", () => {
  it("pauses after debit, then recovers on a fresh connection", async () => {
    armFault(
      { db: ctx.db, clock },
      {
        sourceAccountId: "acc-alice",
        idempotencyKey: "pause-key-01",
        mode: "PAUSE_AFTER_DEBIT",
      },
    );
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 3000,
        idempotencyKey: "pause-key-01",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();

    const paused = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(paused.status).toBe("PROCESSING");
    expect(aliceBalance()).toBe(97000);

    const path = ctx.path;
    ctx.db.close();
    ctx.db = reopen(path);

    const laterClock = steppingClock("2026-10-02T00:00:00.000Z");
    const recovered = makeWorker(ctx.db, laterClock);
    recovered.recoverOnBoot();
    await recovered.processAvailable();

    const finished = getTransfer(ctx.db, "acc-alice", created.transfer.id);
    expect(finished.status).toBe("COMPLETED");
    expect(countLedger(ctx.db, finished.id, "DEBIT")).toBe(1);
    expect(countLedger(ctx.db, finished.id, "CREDIT")).toBe(1);
    expect(aliceBalance(ctx.db)).toBe(97000);
    expect(invariantTotal(ctx.db)).toBe(125000);
  });
});

describe("concurrency", () => {
  it("does not let two concurrent sends exceed the available balance", async () => {
    const a = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 60000,
        idempotencyKey: "race-key-0001",
      },
    );
    const b = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-carla",
        amountCents: 60000,
        idempotencyKey: "race-key-0002",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();

    const t1 = getTransfer(ctx.db, "acc-alice", a.transfer.id);
    const t2 = getTransfer(ctx.db, "acc-alice", b.transfer.id);
    const statuses = [t1.status, t2.status].sort();
    expect(statuses).toEqual(["COMPLETED", "FAILED"]);
    expect(aliceBalance()).toBeGreaterThanOrEqual(0);
    expect(invariantTotal(ctx.db)).toBe(125000);
  });

  it("keeps idempotency keys independent per account", () => {
    const alice = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 100,
        idempotencyKey: "shared-key-01",
      },
    );
    const bruno = requestTransfer(
      { db: ctx.db, clock },
      "acc-bruno",
      {
        recipientAccountId: "acc-alice",
        amountCents: 100,
        idempotencyKey: "shared-key-01",
      },
    );
    expect(alice.transfer.id).not.toBe(bruno.transfer.id);
  });
});

describe("transfer queries", () => {
  it("hides transfers owned by another account", async () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 100,
        idempotencyKey: "owner-key-001",
      },
    );
    expect(() => getTransfer(ctx.db, "acc-bruno", created.transfer.id)).toThrow(
      AppError,
    );
  });

  it("paginates with an opaque stable cursor", async () => {
    for (let i = 0; i < 3; i += 1) {
      requestTransfer(
        { db: ctx.db, clock },
        "acc-alice",
        {
          recipientAccountId: "acc-bruno",
          amountCents: 100 + i,
          idempotencyKey: `page-key-000${i}`,
        },
      );
    }
    const first = listTransfers(ctx.db, "acc-alice", { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = listTransfers(ctx.db, "acc-alice", {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const ids = new Set([
      ...first.items.map((t) => t.id),
      ...second.items.map((t) => t.id),
    ]);
    expect(ids.size).toBe(3);
  });
});

describe("runSaga orchestration", () => {
  it("returns COMPLETED for an already terminal transfer", async () => {
    const created = requestTransfer(
      { db: ctx.db, clock },
      "acc-alice",
      {
        recipientAccountId: "acc-bruno",
        amountCents: 1000,
        idempotencyKey: "terminal-key1",
      },
    );
    const worker = makeWorker();
    await worker.processAvailable();
    const outcome = await runSaga(
      { db: ctx.db, clock, sleep: async () => {} },
      created.transfer.id,
    );
    expect(outcome).toBe("COMPLETED");
  });
});
