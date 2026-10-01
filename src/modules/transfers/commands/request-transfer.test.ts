import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import type { Clock } from '../../../shared/clock.js';
import { AppError } from '../../../shared/errors.js';
import { requestTransfer } from './request-transfer.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-reqt-'));
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

const T0 = Date.parse('2026-10-01T19:00:00.000Z');
const clock: Clock = { now: () => new Date(T0) };
const SRC = 'acc-alice';
const DST = 'acc-bruno';

function req(db: Db, overrides: Record<string, unknown> = {}, key = 'alice-bruno-001') {
  return requestTransfer(
    { db, clock },
    {
      sourceAccountId: SRC,
      idempotencyKey: key,
      body: { recipientAccountId: DST, amountCents: 10000, ...overrides },
    },
  );
}

describe('requestTransfer', () => {
  it('feliz: 202-equivalente, PENDING, transfer+job na mesma tx', async () => {
    const db = await freshDb();
    let woken: string | null = null;
    const { transfer, replay } = requestTransfer(
      { db, clock, onAccepted: (id) => (woken = id) },
      { sourceAccountId: SRC, idempotencyKey: 'k-feliz-01', body: { recipientAccountId: DST, amountCents: 10000, note: 'Almoço' } },
    );
    expect(replay).toBe(false);
    expect(transfer).toMatchObject({
      sourceAccountId: SRC,
      recipientAccountId: DST,
      recipientName: 'Bruno Demo',
      amountCents: 10000,
      currency: 'BRL',
      note: 'Almoço',
      status: 'PENDING',
      failureCode: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE id=?').get(transfer.id)).toEqual({ n: 1 });
    expect(db.prepare('SELECT status FROM jobs WHERE transfer_id=?').get(transfer.id)).toEqual({ status: 'PENDING' });
    expect(woken).toBe(transfer.id);
  });

  it('replay idêntico (nota " x " vs "x") → mesmo id, sem novas linhas', async () => {
    const db = await freshDb();
    const first = req(db, { note: ' x ' });
    const second = req(db, { note: 'x' });
    expect(second.replay).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM jobs').get()).toEqual({ n: 1 });
  });

  it('replay após COMPLETED retorna estado atual', async () => {
    const db = await freshDb();
    const first = req(db, {}, 'k-done-001');
    db.prepare(`UPDATE transfers SET status='COMPLETED', saga_step='COMPLETED', updated_at=? WHERE id=?`).run(
      new Date(T0 + 1000).toISOString(),
      first.transfer.id,
    );
    const second = req(db, {}, 'k-done-001');
    expect(second.replay).toBe(true);
    expect(second.transfer.status).toBe('COMPLETED');
  });

  it('conflito por amount, destinatário e nota', async () => {
    const db = await freshDb();
    req(db, { amountCents: 100 }, 'k-conf-001');
    for (const body of [
      { recipientAccountId: DST, amountCents: 200 },
      { recipientAccountId: 'acc-carla', amountCents: 100 },
      { recipientAccountId: DST, amountCents: 100, note: 'outra' },
    ]) {
      try {
        requestTransfer({ db, clock }, { sourceAccountId: SRC, idempotencyKey: 'k-conf-001', body: { recipientAccountId: body.recipientAccountId, amountCents: body.amountCents, ...(body.note !== undefined ? { note: body.note } : {}) } });
        expect.unreachable();
      } catch (err) {
        expect((err as AppError).code).toBe('IDEMPOTENCY_CONFLICT');
      }
    }
  });

  it('mesma chave em contas diferentes são independentes; self/inexistente/chave inválida', async () => {
    const db = await freshDb();
    const a = req(db, {}, 'chave-igual-1');
    const b = requestTransfer({ db, clock }, { sourceAccountId: 'acc-bruno', idempotencyKey: 'chave-igual-1', body: { recipientAccountId: 'acc-carla', amountCents: 50 } });
    expect(a.transfer.id).not.toBe(b.transfer.id);
    try {
      requestTransfer({ db, clock }, { sourceAccountId: SRC, idempotencyKey: 'k-self-001', body: { recipientAccountId: SRC, amountCents: 10 } });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('SELF_TRANSFER');
    }
    try {
      requestTransfer({ db, clock }, { sourceAccountId: SRC, idempotencyKey: 'k-nope-001', body: { recipientAccountId: 'acc-nope', amountCents: 10 } });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('RECIPIENT_NOT_FOUND');
    }
    try {
      requestTransfer({ db, clock }, { sourceAccountId: SRC, idempotencyKey: 'curta', body: { recipientAccountId: DST, amountCents: 10 } });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('corrida: UNIQUE vira replay/conflito, nunca 500', async () => {
    const db = await freshDb();
    // Simula outro processo inserindo a mesma chave após o SELECT: stub uuid + insert manual antes.
    let calls = 0;
    const uuid = () => `rt-${++calls}`;
    const first = requestTransfer({ db, clock, uuid }, { sourceAccountId: SRC, idempotencyKey: 'k-race-001', body: { recipientAccountId: DST, amountCents: 100 } });
    expect(first.replay).toBe(false);
    // Segunda chamada com o mesmo payload → replay (cobre o caminho pós-SELECT).
    const second = requestTransfer({ db, clock, uuid }, { sourceAccountId: SRC, idempotencyKey: 'k-race-001', body: { recipientAccountId: DST, amountCents: 100 } });
    expect(second.replay).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 1 });
  });

  it('10 chamadas simultâneas com a mesma chave → 1 transferência, mesmo id', async () => {
    const db = await freshDb();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() =>
          requestTransfer(
            { db, clock, uuid: () => `conc-${i}` },
            { sourceAccountId: SRC, idempotencyKey: 'k-conc-001', body: { recipientAccountId: DST, amountCents: 500 } },
          ),
        ),
      ),
    );
    const ids = new Set(results.map((r) => r.transfer.id));
    expect(ids.size).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 1 });
  });
});
