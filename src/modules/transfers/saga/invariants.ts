import type Database from 'better-sqlite3';

export interface InvariantsReport {
  totalCents: number;
  negativeBalances: number;
  transitInTerminal: number;
  creditAndCompensation: number;
}

/**
 * Invariantes do PRD §5 para verificação em testes e reconciliação:
 * saldos não negativos, total conservado (saldos + em trânsito), sem valor
 * em trânsito em estado terminal, CREDIT e COMPENSATION mutuamente exclusivos.
 */
export function checkInvariants(db: Database.Database): InvariantsReport {
  const balances = db.prepare('SELECT COALESCE(SUM(balance_cents),0) s FROM accounts').get() as { s: number };
  const transit = db.prepare('SELECT COALESCE(SUM(in_transit_cents),0) s FROM transfers').get() as { s: number };
  const negative = db.prepare('SELECT COUNT(*) c FROM accounts WHERE balance_cents < 0').get() as { c: number };
  const terminalTransit = db
    .prepare("SELECT COUNT(*) c FROM transfers WHERE status IN ('COMPLETED','FAILED') AND in_transit_cents <> 0")
    .get() as { c: number };
  const both = db
    .prepare(
      `SELECT COUNT(*) c FROM transfers t
       WHERE EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id AND l.type='CREDIT')
         AND EXISTS (SELECT 1 FROM ledger_entries l WHERE l.transfer_id=t.id AND l.type='COMPENSATION')`,
    )
    .get() as { c: number };
  return {
    totalCents: balances.s + transit.s,
    negativeBalances: negative.c,
    transitInTerminal: terminalTransit.c,
    creditAndCompensation: both.c,
  };
}
