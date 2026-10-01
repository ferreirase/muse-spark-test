import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { seed, SEED_CREATED_AT } from '../../db/seed.js';
import { createPauseRegistry } from './pause-registry.js';
import { armFault, createFaultHooks } from './faults.js';
import { runSaga } from '../transfers/saga/orchestrator.js';
import { checkInvariants } from '../transfers/saga/invariants.js';

let dir: string;
let db: Database.Database;
const NOW = () => new Date('2026-10-01T12:00:00.000Z');
const noSleep = async () => {};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'muse-faults-'));
  db = openDatabase(join(dir, 's.sqlite'));
  migrate(db);
  await seed(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeTransfer(id: string, key: string) {
  db.prepare(
    "INSERT INTO transfers (id,source_account_id,recipient_account_id,amount_cents,note,status,failure_code,saga_step,in_transit_cents,attempts,idempotency_key,payload_fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING',NULL,'CREATED',0,0,?,?,?,?)",
  ).run(id, 'acc-alice', 'acc-bruno', 1000, null, key, 'fp', SEED_CREATED_AT, SEED_CREATED_AT);
  db.prepare("INSERT INTO jobs (id,transfer_id,status,run_after,created_at,updated_at) VALUES (?,?,'PENDING',?,?,?)")
    .run(`job-${id}`, id, SEED_CREATED_AT, SEED_CREATED_AT, SEED_CREATED_AT);
}

const transfer = (id: string) => db.prepare('SELECT * FROM transfers WHERE id=?').get(id) as Record<string, unknown>;
const faultRow = (src: string, key: string) =>
  db.prepare('SELECT * FROM test_faults WHERE source_account_id=? AND idempotency_key=?').get(src, key) as Record<string, unknown>;
const balance = (id: string) => (db.prepare('SELECT balance_cents b FROM accounts WHERE id=?').get(id) as { b: number }).b;
const ledgerTypes = (id: string) =>
  (db.prepare('SELECT type FROM ledger_entries WHERE transfer_id=? ORDER BY type').all(id) as { type: string }[]).map((r) => r.type);

const deps = (hooks: ReturnType<typeof createFaultHooks>, over: Record<string, unknown> = {}) => ({
  db, clock: NOW, hooks, retry: { sleep: noSleep, random: () => 0 }, ...over,
});

describe('armFault', () => {
  it('valida mode e chave', () => {
    expect(() => armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'curta', mode: 'FAIL_CREDIT_ONCE' }, NOW())).toThrow();
    expect(() => armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'chave-valida-001', mode: 'OUTRO' as never }, NOW())).toThrow();
  });

  it('rearmar reseta o consumo', () => {
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'k-12345678', mode: 'FAIL_CREDIT_ONCE' }, NOW());
    db.prepare('UPDATE test_faults SET consumed_at=? WHERE idempotency_key=?').run(NOW().toISOString(), 'k-12345678');
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'k-12345678', mode: 'FAIL_CREDIT_ONCE' }, NOW());
    expect(faultRow('acc-alice', 'k-12345678').consumed_at).toBeNull();
  });
});

describe('FAIL_CREDIT_ONCE', () => {
  it('falha definitiva antes do crédito → FAILED/CREDIT_FAILED com compensação e invariantes', async () => {
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'alice-key-001', mode: 'FAIL_CREDIT_ONCE' }, NOW());
    makeTransfer('t1', 'alice-key-001');
    const hooks = createFaultHooks({ db, clock: NOW, registry: createPauseRegistry() });

    const out = await runSaga(deps(hooks), 't1');
    expect(out).toBe('FAILED');
    expect(transfer('t1')).toMatchObject({ status: 'FAILED', failure_code: 'CREDIT_FAILED', in_transit_cents: 0 });
    expect(ledgerTypes('t1')).toEqual(['COMPENSATION', 'DEBIT']);
    expect(balance('acc-alice')).toBe(100000);
    const f = faultRow('acc-alice', 'alice-key-001');
    expect(f.consumed_at).toBeTruthy(); // consumo persistido na tx de markCompensating
    expect(checkInvariants(db).totalCents).toBe(125000);
  });

  it('não afeta transferência com outra chave', async () => {
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'alice-key-001', mode: 'FAIL_CREDIT_ONCE' }, NOW());
    makeTransfer('t2', 'outra-key-002');
    const hooks = createFaultHooks({ db, clock: NOW, registry: createPauseRegistry() });
    expect(await runSaga(deps(hooks), 't2')).toBe('COMPLETED');
    expect(faultRow('acc-alice', 'alice-key-001').consumed_at).toBeNull(); // segue armada
  });

  it('redelivery não dispara a fault de novo', async () => {
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'alice-key-001', mode: 'FAIL_CREDIT_ONCE' }, NOW());
    makeTransfer('t1', 'alice-key-001');
    const hooks = createFaultHooks({ db, clock: NOW, registry: createPauseRegistry() });
    await runSaga(deps(hooks), 't1');
    const consumedAt = faultRow('acc-alice', 'alice-key-001').consumed_at;
    // reexecuta a saga (redelivery): terminal, sem efeitos novos
    expect(await runSaga(deps(hooks), 't1')).toBe('FAILED');
    expect(faultRow('acc-alice', 'alice-key-001').consumed_at).toBe(consumedAt);
    expect(ledgerTypes('t1')).toEqual(['COMPENSATION', 'DEBIT']);
  });
});

describe('PAUSE_AFTER_DEBIT', () => {
  it('pausa determinística após o débito; release completa', async () => {
    const registry = createPauseRegistry();
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'pause-key-01', mode: 'PAUSE_AFTER_DEBIT' }, NOW());
    makeTransfer('t1', 'pause-key-01');
    const hooks = createFaultHooks({ db, clock: NOW, registry });

    let settled = false;
    const saga = runSaga(deps(hooks), 't1').then((r) => { settled = true; return r; });

    // estado pausado: DEBITED/PROCESSING, in_transit = amount, consumo persistido
    await vi.waitFor(() => {
      expect(faultRow('acc-alice', 'pause-key-01').consumed_at).toBeTruthy();
    }, { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 30));
    expect(transfer('t1')).toMatchObject({ status: 'PROCESSING', saga_step: 'DEBITED', in_transit_cents: 1000 });
    expect(ledgerTypes('t1')).toEqual(['DEBIT']);
    expect(balance('acc-alice')).toBe(99000);
    expect(settled).toBe(false); // sem sleep: saga realmente bloqueada

    registry.release('t1');
    expect(await saga).toBe('COMPLETED');
    expect(transfer('t1')).toMatchObject({ status: 'COMPLETED', in_transit_cents: 0 });
    expect(balance('acc-bruno')).toBe(26000);
    expect(checkInvariants(db).totalCents).toBe(125000);
  });

  it('reinício com pausa consumida: nova conexão completa sem release', async () => {
    const registry = createPauseRegistry();
    armFault(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'pause-key-01', mode: 'PAUSE_AFTER_DEBIT' }, NOW());
    makeTransfer('t1', 'pause-key-01');
    const hooks = createFaultHooks({ db, clock: NOW, registry });
    // como o worker faz: um AbortController por saga, registrado no registry
    const ac = new AbortController();
    registry.register(ac);
    const saga = runSaga(deps(hooks, { signal: ac.signal }), 't1');
    await vi.waitFor(() => {
      expect(transfer('t1')).toMatchObject({ saga_step: 'DEBITED' });
      expect(faultRow('acc-alice', 'pause-key-01').consumed_at).toBeTruthy();
    }, { timeout: 3000 });

    // "mata o processo": aborta esperas/sinais; saga abortada NÃO credita
    registry.abortAll();
    expect(await saga).toBe('RETRY_LATER');
    expect(ledgerTypes('t1')).toEqual(['DEBIT']); // nenhum crédito pós-abort

    const file = join(dir, 's.sqlite');
    db.close();
    const db2 = openDatabase(file);
    const hooks2 = createFaultHooks({ db: db2, clock: NOW, registry: createPauseRegistry() });
    const out = await runSaga({ db: db2, clock: NOW, hooks: hooks2, retry: { sleep: noSleep, random: () => 0 } }, 't1');
    expect(out).toBe('COMPLETED');
    const types = (db2.prepare('SELECT type FROM ledger_entries WHERE transfer_id=? ORDER BY type').all('t1') as { type: string }[]).map((r) => r.type);
    expect(types).toEqual(['CREDIT', 'DEBIT']); // um de cada, sem duplicar
    db = openDatabase(file); // para o afterEach
  });
});

describe('PauseRegistry waits', () => {
  it('release sem pausa é no-op; abortAll libera waits e sinais', async () => {
    const registry = createPauseRegistry();
    registry.release('inexistente'); // no-op, não lança
    const ac = new AbortController();
    registry.register(ac);
    let done = false;
    const p = registry.wait('t1', ac.signal).then(() => { done = true; });
    expect(done).toBe(false);
    registry.abortAll();
    await p;
    expect(done).toBe(true);
    expect(ac.signal.aborted).toBe(true);
    // signal já abortado: wait retorna na hora
    await registry.wait('t2', ac.signal);
  });
});
