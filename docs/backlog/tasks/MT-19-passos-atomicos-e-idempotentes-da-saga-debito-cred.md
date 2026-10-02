---
id: MT-19
title: Passos atômicos e idempotentes da Saga (débito, crédito, compensação)
status: Done
priority: high
labels:
  - saga
  - transfers
  - cqrs
  - unit-tests
parent: MT-6
dependencies:
  - MT-15
created_at: 2026-10-01T20:08:48.837Z
updated_at: 2026-10-02T01:03:32.084Z
---

<description>
Implementar os comandos internos da Saga, cada um em **sua própria** transação local `immediate`, com guarda de estado que torna a reexecução um no-op: `debitStep`, `creditStep`, `markCompensating`, `compensateStep`. São o coração de B05, B08, B09 e B10.
</description>

<context>
- Tabela de estados e commits: PRD §5 e doc-1 §5.
- PRD §5 regra 3: débito com SQL condicionado a saldo (`UPDATE accounts SET balance_cents = balance_cents - :amt WHERE id = :src AND balance_cents >= :amt`), sem race leitura→escrita.
- Regra 4: crédito e COMPLETED no mesmo commit; crédito nunca sem débito registrado.
- Regra 5: falha definitiva antes do commit do crédito → COMPENSATING e reembolso em novo commit.
- Compensar = somar o valor de volta (`balance_cents + amt`), nunca restaurar snapshot.
- Ponto de não retorno: após commit do crédito, nunca compensar.
- Estado terminal ⇒ `in_transit_cents = 0` e job `DONE` no mesmo commit.
- Constraints/triggers da migração 001 são a segunda linha de defesa.
- Arquivo: `src/modules/transfers/saga/steps.ts`. Recebe `db` e `now` injetados.
</context>

<plan>
1. Tipo `StepResult = 'APPLIED' | 'ALREADY_APPLIED' | 'INSUFFICIENT_FUNDS'`.
2. `debitStep(db, transferId, now)` em `transaction().immediate()`:
   - `UPDATE transfers SET saga_step='DEBITED', status='PROCESSING', in_transit_cents=amount_cents, updated_at=? WHERE id=? AND saga_step='CREATED'` — se `changes=0` → `ALREADY_APPLIED` (nada mais é feito);
   - débito condicionado; se `changes=0` → desfazer a guarda: `UPDATE transfers SET saga_step='FAILED', status='FAILED', failure_code='INSUFFICIENT_FUNDS', in_transit_cents=0` + `UPDATE jobs SET status='DONE'` → `INSUFFICIENT_FUNDS`;
   - senão `INSERT ledger DEBIT (-amount)`, `accounts.updated_at` → `APPLIED`.
3. `creditStep(db, transferId, now)` em tx immediate: guarda `saga_step='DEBITED'`; verificar ledger DEBIT existe; `UPDATE accounts SET balance_cents = balance_cents + amt WHERE id = recipient` — `changes=0` → lançar `CreditFailedError` (rollback); `INSERT ledger CREDIT (+amt)`; transfer `COMPLETED`/`COMPLETED`, `in_transit_cents=0`; job `DONE`.
4. `markCompensating(db, transferId, reason, now)`: guarda `DEBITED` → `COMPENSATING`, `status='PROCESSING'`, `last_error=reason`.
5. `compensateStep(db, transferId, now)`: guarda `COMPENSATING`; `balance + amt` na conta de origem; `INSERT ledger COMPENSATION (+amt)`; transfer `FAILED`/`CREDIT_FAILED`, `in_transit_cents=0`; job `DONE`.
6. Nenhuma função captura `SqliteError` de BUSY: deixa propagar para a política de retry do orquestrador.
7. Função auxiliar de teste/README `checkInvariants(db)` em `src/modules/transfers/saga/invariants.ts`: retorna `{ totalCents, negativeBalances, transitInTerminal, creditAndCompensation }`.
</plan>

<acceptance>
- [x] Cada passo é uma transação separada; nenhum código faz débito e crédito na mesma transação
- [x] Débito usa UPDATE condicionado a saldo (sem SELECT-then-UPDATE)
- [x] Saldo insuficiente termina FAILED/INSUFFICIENT_FUNDS sem ledger e sem alteração de saldo
- [x] Reexecutar qualquer passo já aplicado retorna `ALREADY_APPLIED` e não altera saldo nem ledger
- [x] Compensação soma o valor de volta preservando operações concorrentes legitimas na mesma conta
- [x] Estados terminais têm `in_transit_cents=0` e job DONE
- [x] `checkInvariants` retorna total 125000 em todos os cenários testados
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/transfers/saga/steps.test.ts` (SQLite temporário em arquivo + migrate + seed, inserindo transferência+job CREATED direto no banco):
- feliz: debit → credit; saldos Alice 90000 / Bruno 35000; ledger DEBIT+CREDIT; COMPLETED
- Carla (saldo 0) envia 1 → FAILED/INSUFFICIENT_FUNDS, sem ledger
- saldo exato (Bruno envia 25000) → sucesso, saldo 0
- debit 2×, credit 2×, compensate 2× → segunda chamada ALREADY_APPLIED, sem efeito
- credit em transfer CREATED (sem débito) → ALREADY_APPLIED/no-op, nunca credita
- compensação: debit → markCompensating → compensate; saldo restaurado, FAILED/CREDIT_FAILED
- compensação não é snapshot: debit T1 de Alice, debit+credit T2 de Alice, compensate T1 → saldo final = inicial − T2
- disputa: duas transferências de Bruno de 20000 → só uma debita, outra INSUFFICIENT_FUNDS
- invariantes após cada cenário
</tests>

<risks>
- Esquecer a guarda de estado torna redelivery perigoso: todo UPDATE de transfers deve ter `AND saga_step = <esperado>`.
- `better-sqlite3` transações são síncronas: não usar `await` dentro do callback de transação.
</risks>

<summary>
`saga/steps.ts`: `stepDebit` (UPDATE condicionado a saldo + ledger DEBIT + in_transit), `stepMarkInsufficientFunds`, `stepCredit` (crédito+CREDIT+in_transit=0+job DONE; CreditFailedError se conta não creditável), `stepMarkCompensating`, `stepCompensate` (reembolso+COMPENSATION+FAILED). Cada passo em `transaction().immediate()` com guarda `WHERE saga_step=<esperado>` → `ALREADY_APPLIED`. Erros BUSY não são capturados (retry fica no orquestrador). Testes em `tests/unit/transfers.test.ts` (feliz, insuficiente, idempotência de passo, compensação, disputa, invariantes).
</summary>
