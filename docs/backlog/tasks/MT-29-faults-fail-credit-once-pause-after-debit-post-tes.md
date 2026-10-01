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
updated_at: 2026-10-01T21:37:38.217Z
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
Executado conforme plano, com ajuste: hooks recebem {id, sourceAccountId, idempotencyKey} (orquestrador lê idempotency da linha). Consumo FAIL_CREDIT em tx própria antes do crédito; PAUSE consome e espera PauseRegistry. E2E: FAIL→FAILED/CREDIT_FAILED, PAUSE→PROCESSING→release→COMPLETED, 403 sem token.
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
Faults por (source,key) com consumo persistido + PauseRegistry sem sleep + rotas faults/release. 6 testes, 132 totais, e2e completo verificado.
</summary>
