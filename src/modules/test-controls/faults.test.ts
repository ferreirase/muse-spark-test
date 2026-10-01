import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from '../../db/connection.js';
import { migrate } from '../../db/migrate.js';
import { INITIAL_TOTAL_CENTS, seed } from '../../db/seed.js';
import { AppError } from '../../shared/errors.js';
import { checkInvariants } from '../transfers/saga/invariants.js';
import { runSaga } from '../transfers/saga/orchestrator.js';
import { insertCreatedTransfer } from '../transfers/saga/steps.js';
import { requestTransfer } from '../transfers/commands/request-transfer.js';
import type { Clock } from '../../shared/clock.js';
import { createFaultHooks } from './fault-hooks.js';
import { findArmedFault } from './faults.js';
import { PauseRegistry } from './pause-registry.js';

let dirs: string[] = [];
let dbs: Db[] = [];

async function freshDb(): Promise<{ db: Db; file: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'bank-faults-'));
  dirs.push(dir);
  const file = join(dir, 's.sqlite');
  const db = openDatabase(file);
  dbs.push(db);
  migrate(db);
  await seed(db);
  return { db, file };
}

function closeAll(): void {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
  }
  dbs = [];
}

afterEach(() => {
  closeAll();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const T = '2026-10-01T19:00:00.000Z';
const T0 = Date.parse(T);
const clock: Clock = { now: () => new Date(T0) };
const fastRetry = { attempts: 5, baseMs: 1, sleep: async () => undefined, random: () => 0 };

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (cond()) return;
    if (Date.now() - start > timeoutMs) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('faults', () => {
  it('FAIL_CREDIT_ONCE → FAILED/CREDIT_FAILED, DEBIT+COMPENSATION, saldo restaurado', async () => {
    const { db } = await freshDb();
    const { hooks } = createFaultHooks({ db, now: () => T });
    const { transfer } = requestTransfer(
      { db, clock },
      { sourceAccountId: 'acc-alice', idempotencyKey: 'fault-fail-001', body: { recipientAccountId: 'acc-bruno', amountCents: 7000 } },
    );
    db.prepare(`INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at) VALUES ('f1','acc-alice','fault-fail-001','FAIL_CREDIT_ONCE','${T}')`).run();
    await expect(runSaga({ db, now: () => T, retry: fastRetry, hooks }, transfer.id)).resolves.toBe('FAILED');
    const row = db.prepare('SELECT status, failure_code AS f FROM transfers WHERE id=?').get(transfer.id) as { status: string; f: string };
    expect(row).toEqual({ status: 'FAILED', f: 'CREDIT_FAILED' });
    expect(db.prepare('SELECT type FROM ledger_entries WHERE transfer_id=? ORDER BY type').all(transfer.id)).toEqual([
      { type: 'COMPENSATION' },
      { type: 'DEBIT' },
    ]);
    expect((db.prepare('SELECT balance_cents AS b FROM accounts WHERE id=?').get('acc-alice') as { b: number }).b).toBe(100000);
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
    // Consumida: segunda saga não re-dispara (já terminal, mas fault marcada).
    expect(findArmedFault(db, 'acc-alice', 'fault-fail-001')).toBeNull();
  });

  it('fault só afeta a transferência com mesma (source, key)', async () => {
    const { db } = await freshDb();
    const { hooks } = createFaultHooks({ db, now: () => T });
    db.prepare(`INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at) VALUES ('f2','acc-alice','fault-only-001','FAIL_CREDIT_ONCE','${T}')`).run();
    const other = requestTransfer(
      { db, clock },
      { sourceAccountId: 'acc-alice', idempotencyKey: 'outra-chave-001', body: { recipientAccountId: 'acc-bruno', amountCents: 100 } },
    );
    await expect(runSaga({ db, now: () => T, retry: fastRetry, hooks }, other.transfer.id)).resolves.toBe('COMPLETED');
  });

  it('PAUSE_AFTER_DEBIT → PROCESSING com DEBIT; release → COMPLETED', async () => {
    const { db } = await freshDb();
    const { hooks, pauseRegistry } = createFaultHooks({ db, now: () => T });
    const { transfer } = requestTransfer(
      { db, clock },
      { sourceAccountId: 'acc-alice', idempotencyKey: 'fault-pause-001', body: { recipientAccountId: 'acc-bruno', amountCents: 3000 } },
    );
    db.prepare(`INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at) VALUES ('f3','acc-alice','fault-pause-001','PAUSE_AFTER_DEBIT','${T}')`).run();
    const sagaP = runSaga({ db, now: () => T, retry: fastRetry, hooks }, transfer.id);
    await waitFor(() => pauseRegistry.size === 1);
    // Estado observável durante a pausa: PROCESSING, DEBIT, in_transit = amount.
    const row = db.prepare('SELECT status, saga_step AS step, in_transit_cents AS transit FROM transfers WHERE id=?').get(transfer.id) as { status: string; step: string; transit: number };
    expect(row).toEqual({ status: 'PROCESSING', step: 'DEBITED', transit: 3000 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE transfer_id=? AND type='DEBIT'").get(transfer.id)).toEqual({ n: 1 });
    pauseRegistry.release(transfer.id);
    await expect(sagaP).resolves.toBe('COMPLETED');
    expect(checkInvariants(db, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('pausa consumida não bloqueia recuperação (nova conexão, sem release)', async () => {
    const { db, file } = await freshDb();
    const aborter = new AbortController();
    const { hooks, pauseRegistry } = createFaultHooks({ db, now: () => T, signal: aborter.signal });
    const { transfer } = requestTransfer(
      { db, clock },
      { sourceAccountId: 'acc-alice', idempotencyKey: 'fault-restart-01', body: { recipientAccountId: 'acc-bruno', amountCents: 3000 } },
    );
    db.prepare(`INSERT INTO test_faults (id, source_account_id, idempotency_key, mode, armed_at) VALUES ('f4','acc-alice','fault-restart-01','PAUSE_AFTER_DEBIT','${T}')`).run();
    // Primeira execução pausa; simula kill: aborta a espera e fecha a conexão.
    const sagaP = runSaga({ db, now: () => T, retry: fastRetry, hooks, signal: aborter.signal }, transfer.id);
    await waitFor(() => pauseRegistry.size === 1, 10000);
    aborter.abort();
    await expect(sagaP).resolves.toBe('RETRY_LATER');
    closeAll();
    // "Reinício": nova conexão, novos hooks — pausa já consumida, completa direto.
    const db2 = openDatabase(file);
    dbs.push(db2);
    const { hooks: hooks2 } = createFaultHooks({ db: db2, now: () => T });
    await expect(runSaga({ db: db2, now: () => T, retry: fastRetry, hooks: hooks2 }, transfer.id)).resolves.toBe('COMPLETED');
    expect(checkInvariants(db2, INITIAL_TOTAL_CENTS).ok).toBe(true);
  });

  it('PauseRegistry: release sem pausa é no-op; abortAll rejeita', async () => {
    const reg = new PauseRegistry();
    expect(reg.release('inexistente')).toBe(false);
    const p = reg.wait('t1');
    const asserted = expect(p).rejects.toThrowError('reset');
    reg.abortAll('reset');
    await asserted;
    expect(reg.size).toBe(0);
  });

  it('armFaultValidated rejeita mode/chave inválidos', async () => {
    const { db } = await freshDb();
    const { armFaultValidated } = await import('./fault-hooks.js');
    expect(() => armFaultValidated(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'fault-x-0001', mode: 'BOOM' }, T)).toThrowError(AppError);
    try {
      armFaultValidated(db, { sourceAccountId: 'acc-alice', idempotencyKey: 'curta', mode: 'FAIL_CREDIT_ONCE' }, T);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('VALIDATION_ERROR');
    }
    // insertCreatedTransfer não usado aqui — cobre import.
    insertCreatedTransfer(db, { id: 'zz', sourceAccountId: 'acc-alice', recipientAccountId: 'acc-bruno', amountCents: 10, note: null, idempotencyKey: 'kzz-00001', fingerprint: 'fp', now: T });
    expect(db.prepare('SELECT COUNT(*) AS n FROM transfers').get()).toEqual({ n: 1 });
  });
});
