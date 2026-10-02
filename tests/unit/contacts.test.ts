import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addContact } from "../../src/modules/contacts/commands/add-contact.js";
import { listContacts } from "../../src/modules/contacts/queries/list-contacts.js";
import { getRecipient } from "../../src/modules/contacts/queries/get-recipient.js";
import { createTestDb, steppingClock, type TestDb } from "./helpers.js";

let ctx: TestDb;

beforeEach(async () => {
  ctx = await createTestDb();
});

afterEach(() => {
  ctx.cleanup();
});

describe("getRecipient", () => {
  it("returns only id and name", () => {
    expect(getRecipient(ctx.db, "acc-alice", "acc-bruno")).toEqual({
      accountId: "acc-bruno",
      name: "Bruno Demo",
    });
  });

  it("rejects unknown recipients", () => {
    expect(() => getRecipient(ctx.db, "acc-alice", "acc-ghost")).toThrowError(
      /not found/i,
    );
  });

  it("rejects self as recipient", () => {
    try {
      getRecipient(ctx.db, "acc-alice", "acc-alice");
      throw new Error("expected SELF_RECIPIENT");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("SELF_RECIPIENT");
    }
  });
});

describe("addContact", () => {
  it("saves a new contact for the owner", () => {
    const contact = addContact(
      { db: ctx.db, clock: steppingClock(), generateId: () => "contact-x" },
      "user-alice",
      "acc-alice",
      { nickname: "  Carla ", recipientAccountId: "acc-carla" },
    );
    expect(contact).toMatchObject({
      id: "contact-x",
      nickname: "Carla",
      recipientAccountId: "acc-carla",
      recipientName: "Carla Demo",
    });
  });

  it("rejects a duplicate contact", () => {
    expect(() =>
      addContact(
        { db: ctx.db, clock: steppingClock(), generateId: () => "dup" },
        "user-alice",
        "acc-alice",
        { nickname: "Bruno", recipientAccountId: "acc-bruno" },
      ),
    ).toThrowError(/already saved/i);
  });

  it("rejects own account as contact", () => {
    expect(() =>
      addContact(
        { db: ctx.db, clock: steppingClock() },
        "user-alice",
        "acc-alice",
        { nickname: "Me", recipientAccountId: "acc-alice" },
      ),
    ).toThrowError(/own account/i);
  });

  it("rejects unknown recipient", () => {
    expect(() =>
      addContact(
        { db: ctx.db, clock: steppingClock() },
        "user-alice",
        "acc-alice",
        { nickname: "Ghost", recipientAccountId: "acc-ghost" },
      ),
    ).toThrowError(/not found/i);
  });
});

describe("listContacts", () => {
  it("returns owner contacts ordered by nickname then id", () => {
    addContact(
      { db: ctx.db, clock: steppingClock(), generateId: () => "c-z" },
      "user-alice",
      "acc-alice",
      { nickname: "Zeca", recipientAccountId: "acc-carla" },
    );
    const items = listContacts(ctx.db, "user-alice");
    expect(items.map((c) => c.nickname)).toEqual(["Bruno", "Zeca"]);
  });

  it("does not leak contacts between users", () => {
    expect(listContacts(ctx.db, "user-bruno")).toEqual([]);
  });
});
