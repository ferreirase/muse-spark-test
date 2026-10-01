import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { AppError } from '../../../shared/errors.js';
import { insertCreatedTransfer } from '../saga/steps.js';
import { getTransfer } from './get-transfer.js';
import { listTransfers } from './list-transfers.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-tq-'));
  dirs.push(dir);
  const db = openDatabase(join(dir, 's.sqlite'));
  dbs.push(db);
  migrate(db);
  await seed(db);
  return db;
}

afterEach(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
  }
  dbs = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** 45 transferências: 5 timestamps repetidos (9 por timestamp), criador Alice→Bruno. */
function seed45(db: Db): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 45; i++) {
    const id = `h-${String(i).padStart(3, '0')}`;
    const ts = new Date(Date.parse('2026-10-01T19:00:00.000Z') + Math.floor(i / 9) * 1000).toISOString();
    insertCreatedTransfer(db, {
      id,
      sourceAccountId: 'acc-alice',
      recipientAccountId: 'acc-bruno',
      amountCents: 10 + i,
      note: null,
      idempotencyKey: `hk-${id}`,
      fingerprint: 'fp',
      now: ts,
    });
    ids.push(id);
  }
  return ids;
}

describe('transfer queries', () => {
  it('getTransfer: DTO exato; outro usuário e destinatário → 404', async () => {
    const db = await freshDb();
    insertCreatedTransfer(db, {
      id: 'g1', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno',
      amountCents: 500, note: 'oi', idempotencyKey: 'kg1', fingerprint: 'fp', now: '2026-10-01T19:00:00.000Z',
    });
    const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    const t = getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 'g1' });
    expect(Object.keys(t).sort()).toEqual(
      ['amountCents', 'createdAt', 'currency', 'failureCode', 'id', 'note', 'recipientAccountId', 'recipientName', 'sourceAccountId', 'status', 'updatedAt'].sort(),
    );
    expect(t.recipientName).toBe('Bruno Demo');
    expect(JSON.stringify(t)).not.toMatch(/saga_step|in_transit|idempotency|fingerprint|last_error/i);
    const after = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    expect(after).toBe(before);
    // Bruno é destinatário mas não remetente → 404; id inexistente → 404.
    for (const args of [
      { sourceAccountId: 'acc-bruno', transferId: 'g1' },
      { sourceAccountId: 'acc-alice', transferId: 'nope' },
    ]) {
      try {
        getTransfer(db, args);
        expect.unreachable();
      } catch (err) {
        expect((err as AppError).code).toBe('TRANSFER_NOT_FOUND');
      }
    }
  });

  it('mapeia status/failureCode públicos de cada saga_step', async () => {
    const db = await freshDb();
    insertCreatedTransfer(db, {
      id: 'm1', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno',
      amountCents: 10, note: null, idempotencyKey: 'km1', fingerprint: 'fp', now: '2026-10-01T19:00:00.000Z',
    });
    const states: Array<[string, string, string | null, string | null]> = [
      ['PENDING', 'CREATED', null, null],
      ['PROCESSING', 'DEBITED', null, null],
      ['PROCESSING', 'COMPENSATING', null, null],
      ['COMPLETED', 'COMPLETED', null, null],
      ['FAILED', 'FAILED', 'INSUFFICIENT_FUNDS', null],
    ];
    for (const [status, step, failure] of states) {
      db.prepare(`UPDATE transfers SET status=?, saga_step=?, failure_code=? WHERE id='m1'`).run(status, step, failure);
      const t = getTransfer(db, { sourceAccountId: 'acc-alice', transferId: 'm1' });
      expect(t.status).toBe(status);
      expect(t.failureCode).toBe(failure);
    }
  });

  it('paginação 20/20/5 sem pular nem duplicar, com createdAt repetidos', async () => {
    const db = await freshDb();
    seed45(db);
    const seen: string[] = [];
    let cursor: string | null | undefined = undefined;
    const sizes: number[] = [];
    for (let page = 0; page < 4; page++) {
      const res = listTransfers(db, { sourceAccountId: 'acc-alice', limit: '20', cursor });
      sizes.push(res.items.length);
      seen.push(...res.items.map((t) => t.id));
      cursor = res.nextCursor;
      if (cursor === null) break;
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
    // Ordem: createdAt desc, id desc.
    const rows = db.prepare(`SELECT id FROM transfers WHERE source_account_id='acc-alice' ORDER BY created_at DESC, id DESC`).all() as { id: string }[];
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('só enviadas; cursor inválido e limit inválido → 400', async () => {
    const db = await freshDb();
    seed45(db);
    // Bruno (destinatário) não vê nada.
    expect(listTransfers(db, { sourceAccountId: 'acc-bruno', limit: '20' })).toEqual({ items: [], nextCursor: null });
    try {
      listTransfers(db, { sourceAccountId: 'acc-alice', limit: '20', cursor: 'adulterado' });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
    }
    for (const limit of ['0', '51', 'abc']) {
      try {
        listTransfers(db, { sourceAccountId: 'acc-alice', limit });
        expect.unreachable();
      } catch (err) {
        expect((err as AppError).code).toBe('VALIDATION_ERROR');
      }
    }
  });
});
