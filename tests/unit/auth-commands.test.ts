import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signup } from "../../src/modules/auth/commands/signup.js";
import { signin } from "../../src/modules/auth/commands/signin.js";
import { signout } from "../../src/modules/auth/commands/signout.js";
import { getMe } from "../../src/modules/auth/queries/get-me.js";
import { getBalance } from "../../src/modules/accounts/queries/get-balance.js";
import { AppError } from "../../src/shared/errors.js";
import { hashSessionToken } from "../../src/modules/auth/session-token.js";
import { createTestDb, steppingClock, type TestDb } from "./helpers.js";

let ctx: TestDb;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(() => {
  ctx.cleanup();
});

function counterIds() {
  let n = 0;
  return () => `id-${++n}`;
}

describe("signup command", () => {
  it("creates user, zero-balance account and a persisted session atomically", async () => {
    const clock = steppingClock();
    const result = await signup(
      { db: ctx.db, clock, generateId: counterIds() },
      { name: "  Nova Pessoa ", email: "Nova@Demo.Local", password: "Password1!" },
    );

    expect(result.auth.user.name).toBe("Nova Pessoa");
    expect(result.auth.user.email).toBe("nova@demo.local");
    expect(result.auth.account.balanceCents).toBe(0);

    const persisted = ctx.db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .get(hashSessionToken(result.token)) as { revoked_at: string | null };
    expect(persisted.revoked_at).toBeNull();
  });

  it("rejects duplicated normalized e-mail", async () => {
    await expect(
      signup(
        { db: ctx.db, clock: steppingClock(), generateId: counterIds() },
        { name: "Alice Other", email: "ALICE@demo.local", password: "Password1!" },
      ),
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_EXISTS" });
  });

  it("rolls back when the e-mail already exists", async () => {
    const before = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM users")
      .get() as { n: number };
    await expect(
      signup(
        { db: ctx.db, clock: steppingClock(), generateId: counterIds() },
        { name: "Dup", email: "alice@demo.local", password: "Password1!" },
      ),
    ).rejects.toBeInstanceOf(AppError);
    const after = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM users")
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});

describe("signin command", () => {
  it("accepts valid credentials and persists a session", async () => {
    const result = await signin(
      { db: ctx.db, clock: steppingClock(), generateId: counterIds() },
      { email: "ALICE@demo.local", password: "Demo123!" },
    );
    expect(result.auth.user.id).toBe("user-alice");
    expect(result.auth.account.id).toBe("acc-alice");
  });

  it("rejects a wrong password", async () => {
    await expect(
      signin(
        { db: ctx.db, clock: steppingClock() },
        { email: "alice@demo.local", password: "WrongPass1!" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rejects an unknown e-mail with the same error", async () => {
    await expect(
      signin(
        { db: ctx.db, clock: steppingClock() },
        { email: "ghost@demo.local", password: "Demo123!" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});

describe("signout and queries", () => {
  it("revokes the session on signout", async () => {
    const clock = steppingClock();
    const result = await signin(
      { db: ctx.db, clock, generateId: counterIds() },
      { email: "alice@demo.local", password: "Demo123!" },
    );
    signout({ db: ctx.db, clock }, result.sessionId);
    const session = ctx.db
      .prepare("SELECT revoked_at FROM sessions WHERE id = ?")
      .get(result.sessionId) as { revoked_at: string | null };
    expect(session.revoked_at).not.toBeNull();
  });

  it("is idempotent without a session", () => {
    expect(signout({ db: ctx.db, clock: steppingClock() }, undefined)).toEqual({
      revoked: false,
    });
  });

  it("getMe returns the authenticated identity and account", () => {
    const me = getMe(ctx.db, "user-alice");
    expect(me?.user.email).toBe("alice@demo.local");
    expect(me?.account.balanceCents).toBe(100000);
  });

  it("getBalance reads the real balance", () => {
    expect(getBalance(ctx.db, "acc-bruno")?.balanceCents).toBe(25000);
    expect(getBalance(ctx.db, "acc-carla")?.balanceCents).toBe(0);
    expect(getBalance(ctx.db, "missing")).toBeUndefined();
  });
});
