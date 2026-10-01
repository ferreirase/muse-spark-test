import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * Passos internos da Saga (PRD §5). Cada passo é UMA transação immediate com
 * guarda de estado (`AND saga_step = <esperado>`): reexecução/redelivery é
 * no-op (ALREADY_APPLIED). Erros SQLITE_BUSY/LOCKED propagam — o retry é do
 * orquestrador. Nunca use await dentro das transações (better-sqlite3 é sync).
 */

export type StepResult = 'APPLIED' | 'ALREADY_APPLIED' | 'INSUFFICIENT_FUNDS';

/** Falha definitiva do crédito (antes do commit): dispara compensação. */
export class CreditFailedError extends Error {
  constructor(message = 'crédito não pôde ser aplicado') {
    super(message);
    this.name = 'CreditFailedError';
  }
}

interface TransferRow {
  source_account_id: string;
  recipient_account_id: string;
  amount_cents: number;
}

function getTransfer(db: Database.Database, id: string): TransferRow {
  const row = db
    .prepare('SELECT source_account_id, recipient_account_id, amount_cents FROM transfers WHERE id=?')
    .get(id) as TransferRow | undefined;
  if (!row) throw new Error(`transferência ${id} não encontrada`);
  return row;
}

/**
 * CREATED → DEBITED. Débito condicionado a saldo no mesmo UPDATE (sem race
 * leitura→escrita). Fundos insuficientes: rollback da guarda + FAILED/
 * INSUFFICIENT_FUNDS + job DONE, sem efeito financeiro.
 */
export function debitStep(db: Database.Database, transferId: string, now: Date): StepResult {
  const step = db.transaction((t: string): StepResult => {
    const nowIso = now.toISOString();
    const guard = db
      .prepare(
        "UPDATE transfers SET saga_step='DEBITED', status='PROCESSING', in_transit_cents=amount_cents, updated_at=? WHERE id=? AND saga_step='CREATED'",
      )
      .run(nowIso, t);
    if (guard.changes === 0) return 'ALREADY_APPLIED';

    const { source_account_id: src, amount_cents: amount } = getTransfer(db, t);
    const debit = db
      .prepare('UPDATE accounts SET balance_cents = balance_cents - ?, updated_at=? WHERE id=? AND balance_cents >= ?')
      .run(amount, nowIso, src, amount);
    if (debit.changes === 0) {
      db.prepare(
        "UPDATE transfers SET saga_step='FAILED', status='FAILED', failure_code='INSUFFICIENT_FUNDS', in_transit_cents=0, updated_at=? WHERE id=? AND saga_step='DEBITED'",
      ).run(nowIso, t);
      db.prepare("UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=? AND status='PENDING'").run(nowIso, t);
      return 'INSUFFICIENT_FUNDS';
    }

    db.prepare('UPDATE accounts SET updated_at=? WHERE id=?').run(nowIso, src);
    db.prepare('INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), t, src, 'DEBIT', -amount, nowIso);
    return 'APPLIED';
  });
  return step.immediate(transferId);
}

/**
 * DEBITED → COMPLETED. Crédito + ledger CREDIT + in_transit=0 + job DONE no
 * mesmo commit. Ponto de não retorno: após este commit nunca compensa.
 */
export function creditStep(db: Database.Database, transferId: string, now: Date): StepResult {
  const step = db.transaction((t: string): StepResult => {
    const nowIso = now.toISOString();
    const { recipient_account_id: dst, amount_cents: amount } = getTransfer(db, t);

    const hasDebit = db
      .prepare("SELECT 1 FROM ledger_entries WHERE transfer_id=? AND type='DEBIT'")
      .get(t);
    if (!hasDebit) return 'ALREADY_APPLIED'; // sem débito registrado, nunca credita

    const guard = db
      .prepare(
        "UPDATE transfers SET saga_step='COMPLETED', status='COMPLETED', in_transit_cents=0, updated_at=? WHERE id=? AND saga_step='DEBITED'",
      )
      .run(nowIso, t);
    if (guard.changes === 0) return 'ALREADY_APPLIED';

    const credit = db
      .prepare('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at=? WHERE id=?')
      .run(amount, nowIso, dst);
    if (credit.changes === 0) {
      throw new CreditFailedError(`conta destinatária ${dst} não existe`);
    }
    db.prepare('INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), t, dst, 'CREDIT', amount, nowIso);
    db.prepare("UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=? AND status='PENDING'").run(nowIso, t);
    return 'APPLIED';
  });
  return step.immediate(transferId);
}

/** DEBITED → COMPENSATING: registra falha definitiva antes do crédito. */
export function markCompensating(db: Database.Database, transferId: string, reason: string, now: Date): StepResult {
  const step = db.transaction((t: string): StepResult => {
    const guard = db
      .prepare(
        "UPDATE transfers SET saga_step='COMPENSATING', status='PROCESSING', last_error=?, updated_at=? WHERE id=? AND saga_step='DEBITED'",
      )
      .run(reason, now.toISOString(), t);
    return guard.changes > 0 ? 'APPLIED' : 'ALREADY_APPLIED';
  });
  return step.immediate(transferId);
}

/**
 * COMPENSATING → FAILED/CREDIT_FAILED. Reembolso SOMA o valor de volta
 * (nunca snapshot) + ledger COMPENSATION + in_transit=0 + job DONE.
 */
export function compensateStep(db: Database.Database, transferId: string, now: Date): StepResult {
  const step = db.transaction((t: string): StepResult => {
    const nowIso = now.toISOString();
    const { source_account_id: src, amount_cents: amount } = getTransfer(db, t);
    const guard = db
      .prepare(
        "UPDATE transfers SET saga_step='FAILED', status='FAILED', failure_code='CREDIT_FAILED', in_transit_cents=0, updated_at=? WHERE id=? AND saga_step='COMPENSATING'",
      )
      .run(nowIso, t);
    if (guard.changes === 0) return 'ALREADY_APPLIED';

    const refund = db
      .prepare('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at=? WHERE id=?')
      .run(amount, nowIso, src);
    if (refund.changes === 0) throw new Error(`conta de origem ${src} não existe para compensação`);
    db.prepare('INSERT INTO ledger_entries (id, transfer_id, account_id, type, amount_cents, created_at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), t, src, 'COMPENSATION', amount, nowIso);
    db.prepare("UPDATE jobs SET status='DONE', updated_at=? WHERE transfer_id=? AND status='PENDING'").run(nowIso, t);
    return 'APPLIED';
  });
  return step.immediate(transferId);
}
