---
id: MT-29
title: Faults FAIL_CREDIT_ONCE / PAUSE_AFTER_DEBIT + POST /__test/faults e
  /__test/release
status: Done
priority: medium
labels:
  - test-controls
  - saga
  - unit-tests
parent: MT-7
dependencies:
  - MT-23
  - MT-28
created_at: 2026-10-01T20:11:40.702Z
updated_at: 2026-10-01T23:35:52.197Z
---

<description>
Injeção determinística de falhas na Saga via tabela `test_faults` e os hooks `afterDebit`/`beforeCredit` do orquestrador. Faults são armadas por (sourceAccountId, idempotencyKey), consumidas uma vez com consumo persistido antes de pausar/falhar.
</description>

<context>
- Contrato §8:
  - `POST /__test/faults` `{sourceAccountId, idempotencyKey, mode}` com modes `FAIL_CREDIT_ONCE` | `PAUSE_AFTER_DEBIT` → 201 `{armed:true}`; associado a uma única transferência; consumido uma vez.
  - `POST /__test/release` `{transferId}` → 204: libera a pausa do worker em execução. Após reinício, pausa já consumida não bloqueia recuperação.
  - `FAIL_CREDIT_ONCE`: falha definitiva antes do commit do crédito → compensação e FAILED/CREDIT_FAILED.
  - `PAUSE_AFTER_DEBIT`: bloqueia depois do commit do débito e antes de qualquer crédito; avaliador consulta estado/ledger, mata o processo e reinicia com o mesmo arquivo. **Não usar sleeps** como substituto da pausa.
- Com flag desligada, hooks são no-op e a tabela nunca é consultada.
- Arquivos: `src/modules/test-controls/faults.ts` (repo + hooks + `PauseRegistry`), rotas em `src/modules/test-controls/routes.ts`.
</context>

<plan>
1. `armFault(db, {sourceAccountId, idempotencyKey, mode}, now)`: valida body (schema `additionalProperties:false`, enum de mode, pattern da chave); upsert em `test_faults` resetando `consumed_at` (rearmar permitido) → 201 `{armed:true}`.
2. `PauseRegistry`: `Map<transferId, {promise, resolve, reject}>`; `wait(transferId, signal)`, `release(transferId)` (no-op se não houver pausa), `abortAll()`.
3. `createFaultHooks({ db, pauseRegistry })`:
   - `afterDebit(transfer)`: em tx, `UPDATE test_faults SET consumed_at=?, transfer_id=? WHERE source_account_id=? AND idempotency_key=? AND mode='PAUSE_AFTER_DEBIT' AND consumed_at IS NULL`; se `changes=1` → `await pauseRegistry.wait(transfer.id)`; senão retorna.
   - `beforeCredit(transfer)`: retorna `'FAIL'` se fault `FAIL_CREDIT_ONCE` não consumida existe. O consumo deve ser gravado **na mesma transação** de `markCompensating` (ajustar o orquestrador para receber `consumeFault` dentro dessa tx).
4. Wiring: `buildApp`/`server` passa hooks reais ao orquestrador só com flag ligada.
5. Rota `POST /__test/release` `{transferId}` → `pauseRegistry.release` → 204.
</plan>

<acceptance>
- [x] Fault armada antes do POST da transferência afeta apenas a transferência com o mesmo (sourceAccountId, idempotencyKey)
- [x] `FAIL_CREDIT_ONCE` → FAILED/CREDIT_FAILED, ledger DEBIT+COMPENSATION, sem CREDIT, saldo do remetente restaurado, invariante 125000
- [x] `PAUSE_AFTER_DEBIT` → transferência fica PROCESSING com ledger DEBIT e in_transit = amount até o release; release → COMPLETED
- [x] Consumo da fault persistido antes de pausar/falhar; replay/redelivery não dispara a fault de novo
- [x] Após "reinício" (nova conexão + novo worker) com pausa consumida, a saga completa sem release
- [x] Nenhum `setTimeout`/sleep usado para implementar a pausa
- [x] Flag desligada: hooks no-op, rotas 404
- [x] Testes unitários passam
</acceptance>

<tests>
`faults.test.ts` (SQLite temporário + seed + orquestrador real):
- armFault valida mode/chave; rearmar reseta consumo
- FAIL_CREDIT_ONCE: runSaga → FAILED/CREDIT_FAILED; fault consumida; segunda transferência com outra chave não afetada
- PAUSE_AFTER_DEBIT: runSaga fica pendente; estado DEBITED/PROCESSING verificado; `release` → COMPLETED
- reinício: pausa consumida, `abortAll`, fechar conexão, abrir nova, novo runSaga → COMPLETED sem novo pause
- `PauseRegistry`: release sem pausa é no-op; abortAll rejeita waits
</tests>

<summary>
faults.ts: armFault com upsert (rearmar reseta consumo), consumePauseFault/hasUnconsumedFailFault/consumeFailFault, createFaultHooks com afterDebit (consome e pausa via registry.wait, sem sleeps), beforeCredit (FAIL se fault não consumida) e consumeOnCompensate (executado DENTRO da tx de markCompensating — orquestrador e steps ajustados com callback consume + snapshot com idempotencyKey + afterDebit(t,signal)). pause-registry ganhou wait/release (Map por transferId, abortAll resolve waits E aborta controllers). Rotas POST /__test/faults (201 {armed:true}) e /__test/release (204). server.ts passa hooks ao worker só com flag ligada. Testes 8 (armar/rearmar, FAIL com compensação+invariantes, escopo por chave, redelivery, pausa determinística com estado DEBITED/in_transit verificado e release→COMPLETED, reinício com reconexão sem duplicar e saga abortada não credita, registry). Commit 4df083d.
</summary>
