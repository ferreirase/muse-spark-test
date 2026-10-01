import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed, SEED_CREATED_AT } from '../../../db/seed.js';
import { getTransfer } from './get-transfer.js';
import { listTransfers } from './list-transfers.js';

let dir: string;
let db: Database.Database;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-lt-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const insertT = (id: string, src: string, dst: string, createdAt: string, over: Record<string, unknown> = {}) => {
  const t = {
    amount_cents: 100, note: null, status: 'PENDING', failure_code: null,
    saga_step: 'CREATED', in_transit_cents: 0, attempts: 0, last_error: null,
    idempotency_key: `key-${id}`, payload_fingerprint: 'fp',
    created_at: createdAt, updated_at: createdAt,
    source_account_id: src, recipient_account_id: dst, id, ...over,
  };
  db.prepare(`INSERT INTO transfers (${Object.keys(t).join(',')}) VALUES (${Object.keys(t).map(() => '?').join(',')})`)
    .run(...Object.values(t));
};

const iso = (ms: number) => new Date(Date.parse('2026-10-02T10:00:00.000Z') + ms).toISOString();

describe('getTransfer', () => {
  it('detalhe do próprio envio com DTO exato', () => {
    insertT('t1', 'acc-alice', 'acc-bruno', iso(0), { status: 'COMPLETED', saga_step: 'COMPLETED' });
    const t = getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't1' })!;
    expect(t).toEqual({
      id: 't1', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno',
      recipientName: 'Bruno Demo', amountCents: 100, currency: 'BRL', note: null,
      status: 'COMPLETED', failureCode: null, createdAt: iso(0), updatedAt: iso(0),
    });
    expect(Object.keys(t).sort()).toEqual([
      'amountCents', 'createdAt', 'currency', 'failureCode', 'id', 'note',
      'recipientAccountId', 'recipientName', 'sourceAccountId', 'status', 'updatedAt',
    ]);
  });

  it('transferência de outro usuário (mesmo destinatário) → 404 TRANSFER_NOT_FOUND', () => {
    insertT('t1', 'acc-bruno', 'acc-alice', iso(0));
    expect(() => getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't1' })).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND', statusCode: 404 }),
    );
    expect(() => getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 'inexistente' })).toThrowError(
      expect.objectContaining({ code: 'TRANSFER_NOT_FOUND' }),
    );
  });

  it('mapeia saga_step DEBITED e COMPENSATING para status público PROCESSING', () => {
    insertT('t1', 'acc-alice', 'acc-bruno', iso(0), { status: 'PROCESSING', saga_step: 'DEBITED' });
    insertT('t2', 'acc-alice', 'acc-bruno', iso(1), { status: 'PROCESSING', saga_step: 'COMPENSATING' });
    expect(getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't1' })!.status).toBe('PROCESSING');
    expect(getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't2' })!.status).toBe('PROCESSING');
    insertT('t3', 'acc-alice', 'acc-bruno', iso(2), { status: 'FAILED', saga_step: 'FAILED', failure_code: 'CREDIT_FAILED' });
    expect(getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't3' })!.failureCode).toBe('CREDIT_FAILED');
  });
});

describe('listTransfers', () => {
  it('45 transferências com timestamps repetidos: páginas 20/20/5 sem duplicar nem pular', () => {
    for (let i = 0; i < 45; i++) {
      // 5 timestamps distintos, 9 transferências por timestamp
      insertT(`t-${String(i).padStart(2, '0')}`, 'acc-alice', 'acc-bruno', iso(Math.floor(i / 9) * 1000));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const page = listTransfers(db, { sourceAccountId: 'acc-alice', limit: 20, cursor });
      pages++;
      seen.push(...page.items.map((t) => t.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(seen.length).toBe(45);
    expect(new Set(seen).size).toBe(45);
    // ordem decrescente por createdAt e id
    const rows = db.prepare("SELECT id, created_at FROM transfers WHERE source_account_id='acc-alice' ORDER BY created_at DESC, id DESC").all() as { id: string }[];
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('só transferências enviadas pelo usuário; destinatário não vê', () => {
    insertT('t-a1', 'acc-alice', 'acc-bruno', iso(0));
    insertT('t-b1', 'acc-bruno', 'acc-alice', iso(1));
    const alice = listTransfers(db, { sourceAccountId: 'acc-alice', limit: 20, cursor: null });
    expect(alice.items.map((t) => t.id)).toEqual(['t-a1']);
    const bruno = listTransfers(db, { sourceAccountId: 'acc-bruno', limit: 20, cursor: null });
    expect(bruno.items.map((t) => t.id)).toEqual(['t-b1']);
    expect(bruno.nextCursor).toBeNull();
  });

  it('limit menor que total gera nextCursor; última página null', () => {
    insertT('t1', 'acc-alice', 'acc-bruno', iso(0));
    insertT('t2', 'acc-alice', 'acc-bruno', iso(1));
    const p1 = listTransfers(db, { sourceAccountId: 'acc-alice', limit: 1, cursor: null });
    expect(p1.items.length).toBe(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = listTransfers(db, { sourceAccountId: 'acc-alice', limit: 1, cursor: p1.nextCursor });
    expect(p2.items.map((t) => t.id)).toEqual(['t1']);
    expect(p2.nextCursor).toBeNull();
  });

  it('não escreve no banco', () => {
    insertT('t1', 'acc-alice', 'acc-bruno', iso(0));
    const before = (db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number }).t;
    getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 't1' });
    listTransfers(db, { sourceAccountId: 'acc-alice', limit: 20, cursor: null });
    const after = (db.prepare('SELECT total_changes() t FROM (SELECT 1)').get() as { t: number }).t;
    expect(after).toBe(before);
  });
});
