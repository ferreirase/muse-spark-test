---
id: MT-27
title: "Worker durável: claim com lease, polling, recuperação no boot e shutdown"
status: Done
priority: high
labels:
  - worker
  - saga
  - unit-tests
parent: MT-6
dependencies:
  - MT-16
  - MT-23
  - MT-25
created_at: 2026-10-01T20:11:08.147Z
updated_at: 2026-10-01T21:15:28.340Z
---

<description>
Worker local no mesmo processo da API que lê a job table SQLite, reivindica jobs com lease, executa `runSaga` e reagenda em caso de `RETRY_LATER`. Garante que a mesma operação não roda em paralelo, que uma transferência travada não bloqueia as outras e que tudo é retomado após reinício. Requisito B10.
</description>

<context>
- PRD §2: um processo de API e worker local recuperável; sem infraestrutura externa.
- PRD §5: worker pode usar job table + polling; coordenar para não processar a mesma operação simultaneamente, com recuperação de claims/locks após crash; falha em uma transferência não bloqueia definitivamente outras.
- PRD §8: transferência normal terminal em ≤ 5 s; recuperação após reinício ou release em ≤ 10 s.
- Contrato §8: reset aguarda worker ocioso ou pausa-o.
- Tabela `jobs(status, run_after, attempts, locked_by, locked_until, last_error)` da migração 001.
- Limitação aceita (documentar no README): um worker por arquivo SQLite; no boot, locks de execuções anteriores são liberados.
- Arquivos: `src/modules/worker/job-repository.ts`, `src/modules/worker/worker.ts`; plugar em `server.ts`.
</context>

<plan>
Executado conforme plano. Desvios: (1) teste de paralelismo entre 2 workers trocado por não-reexecução do mesmo worker — claim entre conexões distintas já coberto no repo; (2) worker criado antes do buildApp (wake disponível no POST) e start() após listen; (3) server usa globalThis.__testSagaHooks/__testAbortSignal como ponto de extensão para MT-29 (documentado). E2E manual: PENDING→COMPLETED automático, saldo 90000.
</plan>

<acceptance>
- [x] Transferência aceita chega a COMPLETED sem intervenção (polling + wake)
- [x] Mesmo job nunca é executado por duas execuções simultâneas (claim condicional + set in-flight)
- [x] Job com lock expirado ou de execução anterior é retomado após `start()`
- [x] `RETRY_LATER` reagenda com backoff e mantém status não terminal
- [x] Uma saga pausada/lenta não impede outras transferências de completar (concorrência > 1)
- [x] `stop()` resolve após in-flight terminarem; `server.ts` fecha worker antes do banco
- [x] Recuperação após reinício ocorre no primeiro tick (bem abaixo de 10 s com poll 200 ms)
- [x] Testes unitários passam
</acceptance>

<tests>
`job-repository.test.ts` (SQLite temporário): claim duplo → só o primeiro vence; lease expirado permite novo claim; `findDueJobs` respeita `run_after`; `releaseAllLocks`.
`worker.test.ts` (SQLite temporário + seed, `runSaga` real ou fake, clock fake, sem sleeps fixos — aguardar condição com timeout via `vi.waitFor`):
- 3 transferências → todas COMPLETED; invariantes ok
- runSaga fake bloqueado numa transferência + outra transferência completa
- runSaga fake retorna RETRY_LATER → job reagendado com `run_after` futuro
- recuperação: debitar manualmente (estado DEBITED + lock antigo), fechar conexão, abrir nova conexão no mesmo arquivo, novo worker `start()` → COMPLETED com um único DEBIT/CREDIT
- `stop()` aguarda in-flight
</tests>

<risks>
- Lease longo + crash: mitigado por `releaseAllLocks` no boot (válido porque há um worker por arquivo; documentar).
- `better-sqlite3` bloqueia o event loop durante a transação; manter transações curtas.
</risks>

<summary>
job-repository + createWorker (claim/lease, polling, wake, pause/resume, isIdle) plugado no server. 9 testes worker, 121 totais, e2e PENDING→COMPLETED verificado.
</summary>
