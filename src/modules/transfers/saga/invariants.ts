import type { Db } from '../../../db/connection.js';

export interface InvariantsReport {
  totalCents: number;
  negativeBalances: Array<{ id: string; balanceCents: number }>;
  transitInTerminal: Array<{ id: string; status: string; inTransit: number }>;
  creditAndCompensation: Array<{ transferId: string }>;
}

/** Verifica invariantes globais da Saga (doc-1 §6). Usada em testes e no README. */
export function checkInvariants(db: Db, expectedTotal: number): InvariantsReport & { ok: boolean } {
  const total = (
    db.prepare('SELECT COALESCE(SUM(balance_cents),0) AS t FROM accounts').get() as { t: number }
  ).t;
  const transit = (
    db.prepare('SELECT COALESCE(SUM(in_transit_cents),0) AS t FROM transfers').get() as { t: number }
  ).t;
  const negativeBalances = db
    .prepare('SELECT id, balance_cents AS balanceCents FROM accounts WHERE balance_cents < 0')
    .all() as Array<{ id: string; balanceCents: number }>;
  const transitInTerminal = db
    .prepare(
      `SELECT id, status, in_transit_cents AS inTransit FROM transfers
       WHERE status IN ('COMPLETED','FAILED') AND in_transit_cents <> 0`,
    )
    .all() as Array<{ id: string; status: string; inTransit: number }>;
  const creditAndCompensation = db
    .prepare(
      `SELECT transfer_id AS transferId FROM ledger_entries WHERE type='CREDIT'
       INTERSECT
       SELECT transfer_id FROM ledger_entries WHERE type='COMPENSATION'`,
    )
    .all() as Array<{ transferId: string }>;
  const ok =
    total + transit === expectedTotal &&
    negativeBalances.length === 0 &&
    transitInTerminal.length === 0 &&
    creditAndCompensation.length === 0;
  return { totalCents: total + transit, negativeBalances, transitInTerminal, creditAndCompensation, ok };
}
