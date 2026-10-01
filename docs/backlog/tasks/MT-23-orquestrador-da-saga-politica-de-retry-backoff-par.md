---
id: MT-23
title: Orquestrador da Saga + política de retry/backoff para falhas transitórias
status: Done
priority: high
labels:
  - saga
  - transfers
  - observability
  - unit-tests
parent: MT-6
dependencies:
  - MT-19
created_at: 2026-10-01T20:09:52.332Z
updated_at: 2026-10-01T20:59:33.676Z
---

<description>
`runSaga(deps, transferId)` lê o estado persistido e executa/retoma os passos até estado terminal ou até esgotar retries transitórios. Inclui `withRetry` (retry limitado por tentativa com backoff exponencial + jitter) e pontos de extensão para injeção de falhas de teste (no-op em produção).
</description>

<context>
- PRD §5 regras 2–7: retomar pelo estado persistido; falhas transitórias (`SQLITE_BUSY`, `SQLITE_LOCKED`) com retry limitado e backoff; esgotamento mantém trabalho recuperável e PROCESSING; nunca declarar FAILED sem compensar; falha definitiva de crédito → COMPENSATING → compensação.
- PRD §7: logs com requestId (quando houver), transferId, etapa e erro.
- Passos: task "Passos atômicos e idempotentes da Saga".
- Pontos de extensão (preenchidos pela task de faults): `hooks.afterDebit(transfer): Promise<void>` (pausa) e `hooks.beforeCredit(transfer): 'FAIL' | 'CONTINUE'` (falha definitiva). Default: no-op.
- Arquivos: `src/modules/transfers/saga/orchestrator.ts`, `src/modules/transfers/saga/retry.ts`.
</context>

<plan>
Executado conforme plano. Todos os cenários de acceptance cobertos em orchestrator.test.ts (10 testes) + retry.test.ts (5).
</plan>

<acceptance>
- [x] Saga retoma corretamente a partir de qualquer `saga_step` persistido (CREATED, DEBITED, COMPENSATING, terminal)
- [x] `SQLITE_BUSY` transitório é repetido com backoff crescente e limitado; outros erros não são repetidos por `withRetry`
- [x] Esgotar retries deixa a transferência em PENDING/PROCESSING (nunca FAILED) com `attempts` e `last_error` gravados
- [x] `CreditFailedError` e hook `FAIL` levam a COMPENSATING e depois FAILED/CREDIT_FAILED com saldo restaurado
- [x] Após COMPLETED nenhuma compensação ocorre, mesmo se hooks/logs falharem depois
- [x] Abort durante pausa não executa passos seguintes
- [x] Logs incluem transferId e etapa
- [x] Testes unitários passam
</acceptance>

<tests>
`retry.test.ts` (função pura, `sleep` e `random` fake): sucesso na 3ª tentativa; esgotamento após N; erro não transitório propaga sem retry; sequência de delays crescente e ≤ maxMs.
`orchestrator.test.ts` (SQLite temporário + seed + transfer CREATED inserida):
- feliz até COMPLETED
- saldo insuficiente → FAILED sem ledger
- hook beforeCredit FAIL → compensação completa, invariantes ok
- step fake que lança SQLITE_BUSY 2× e depois passa → COMPLETED
- step fake sempre BUSY → RETRY_LATER, status PROCESSING/PENDING, nenhum FAILED
- retomada: transferência já em DEBITED (estado montado no banco) → termina COMPLETED sem segundo DEBIT
- retomada em COMPENSATING → FAILED/CREDIT_FAILED
- recuperação com reinício de conexão: debitar, `db.close()`, abrir nova conexão no mesmo arquivo, `runSaga` → COMPLETED, um único DEBIT e CREDIT
</tests>

<summary>
withRetry (5 tentativas, backoff 25ms·2ⁿ+jitter) + runSaga com loop por estado, hooks afterDebit/beforeCredit, AbortSignal, recordRecoverable. 15 testes, 94 totais passando.
</summary>
