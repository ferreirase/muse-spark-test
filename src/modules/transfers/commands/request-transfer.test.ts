import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../../db/connection.js';
import { migrate } from '../../../db/migrate.js';
import { seed } from '../../../db/seed.js';
import { requestTransfer } from './request-transfer.js';

let dir: string;
let db: Database.Database;
const NOW = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-rt-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { c: number }).c;

const call = (over: Partial<Parameters<typeof requestTransfer>[1]> = {}) =>
  requestTransfer(
    { db, now: NOW },
    { sourceAccountId: 'acc-alice', idempotencyKey: 'alice-bruno-001', recipientAccountId: 'acc-bruno', amountCents: 10000, note: 'Almoço', ...over },
  );

describe('requestTransfer', () => {
  it('novo pedido → PENDING com job criado na mesma tx', () => {
    const r = call();
    expect(r.replay).toBe(false);
    expect(r.transfer).toMatchObject({
      sourceAccountId: 'acc-alice',
      recipientAccountId: 'acc-bruno',
      recipientName: 'Bruno Demo',
      amountCents: 10000,
      currency: 'BRL',
      note: 'Almoço',
      status: 'PENDING',
      failureCode: null,
    });
    expect(r.transfer.id).toBeTruthy();
    expect(count('SELECT COUNT(*) c FROM transfers')).toBe(1);
    expect(count('SELECT COUNT(*) c FROM jobs WHERE status=?', 'PENDING')).toBe(1);
    expect(count('SELECT COUNT(*) c FROM jobs j JOIN transfers t ON t.id=j.transfer_id WHERE t.idempotency_key=?', 'alice-bruno-001')).toBe(1);
  });

  it('replay idêntico (nota " x " vs "x") → 200-mesmo id, contagens inalteradas', () => {
    const first = call();
    const second = call({ note: ' Almoço ' });
    expect(second.replay).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(count('SELECT COUNT(*) c FROM transfers')).toBe(1);
    expect(count('SELECT COUNT(*) c FROM jobs')).toBe(1);
  });

  it('replay após virar COMPLETED retorna estado atual', () => {
    const first = call();
    db.prepare("UPDATE transfers SET status='COMPLETED', saga_step='COMPLETED', updated_at=? WHERE id=?").run(NOW.toISOString(), first.transfer.id);
    const second = call();
    expect(second.replay).toBe(true);
    expect(second.transfer.id).toBe(first.transfer.id);
    expect(second.transfer.status).toBe('COMPLETED');
  });

  it('mesma chave com payload diferente → 409 IDEMPOTENCY_CONFLICT (por campo)', () => {
    call();
    for (const over of [{ amountCents: 1 }, { recipientAccountId: 'acc-carla' }, { note: 'Outra' }, { note: null }] as const) {
      expect(() => call(over)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 }));
    }
  });

  it('chaves de contas diferentes são independentes', () => {
    const a = call();
    const b = call({ sourceAccountId: 'acc-bruno', recipientAccountId: 'acc-alice', idempotencyKey: 'alice-bruno-001' });
    expect(b.replay).toBe(false);
    expect(b.transfer.id).not.toBe(a.transfer.id);
  });

  it('self → 422 SELF_TRANSFER; destinatário inexistente → 404', () => {
    expect(() => call({ recipientAccountId: 'acc-alice' })).toThrowError(expect.objectContaining({ code: 'SELF_TRANSFER', statusCode: 422 }));
    expect(() => call({ recipientAccountId: 'acc-fantasma' })).toThrowError(expect.objectContaining({ code: 'RECIPIENT_NOT_FOUND', statusCode: 404 }));
  });

  it('corrida: concorrente commita a mesma chave antes do nosso INSERT → 409/replay, nunca 500', () => {
    let raced = false;
    const origPrepare = db.prepare.bind(db);
    const origTransaction = db.transaction.bind(db);
    const spiedDb = new Proxy(db, {
      get(target, prop) {
        if (prop === 'transaction') {
          return (fn: Parameters<Database.Database['transaction']>[0]) => {
            if (!raced) {
              raced = true;
              // commit autônomo ANTES da nossa transação abrir (simula outro processo)
              origPrepare(
                "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
              ).run('t-race', 'acc-alice', 'acc-bruno', 10000, 'Almoço', 'PENDING', null, 'CREATED', 0, 0, 'alice-bruno-001', 'fp-race', NOW.toISOString(), NOW.toISOString());
              origPrepare('INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('j-race', 't-race', 'PENDING', NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
            }
            return origTransaction(fn);
          };
        }
        if (prop === 'prepare') {
          return (sql: string) => origPrepare(sql);
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });

    expect(() =>
      requestTransfer(
        { db: spiedDb as unknown as Database.Database, now: NOW },
        { sourceAccountId: 'acc-alice', idempotencyKey: 'alice-bruno-001', recipientAccountId: 'acc-bruno', amountCents: 10000, note: 'Almoço' },
      ),
    ).toThrowError(expect.objectContaining({ statusCode: 409 }));
  });

  it('10 chamadas concorrentes com a mesma chave → 1 transferência, mesmos ids', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => call()));
    const ids = new Set(results.map((r) => r.transfer.id));
    expect(ids.size).toBe(1);
    expect(count('SELECT COUNT(*) c FROM transfers')).toBe(1);
    expect(results.filter((r) => r.replay).length).toBe(9);
  });

  it('nota vazia vira null e o valor é aceito', () => {
    const r = call({ note: '   ' });
    expect(r.transfer.note).toBeNull();
  });
});
