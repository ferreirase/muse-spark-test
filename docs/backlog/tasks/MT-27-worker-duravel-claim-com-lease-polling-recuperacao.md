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
updated_at: 2026-10-01T23:22:18.436Z
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
1. `job-repository`: `releaseAllLocks(db)`; `findDueJobs(db, now, limit)` (`status='PENDING' AND run_after<=now AND (locked_until IS NULL OR locked_until<now)` ordem `created_at`); `claimJob(db, jobId, workerId, now, leaseMs)` via `UPDATE ... WHERE id=? AND (locked_until IS NULL OR locked_until<?)` → bool; `rescheduleJob(db, jobId, runAfter, error)`; `unlockJob`.
2. `createWorker({ db, runSaga, clock, pollIntervalMs, concurrency: 4, leaseMs: 60000, logger })` com `start()`, `stop(): Promise<void>` (para de buscar, aguarda in-flight), `wake()`, `pause()/resume()` e `isIdle()` para o reset.
3. Loop: a cada tick (ou `wake`) busca jobs devidos, pula os do `Set` in-flight local, faz claim e executa `runSaga` sem await bloqueante (até `concurrency`). `RETRY_LATER` → `rescheduleJob` com backoff por `attempts` (ex.: 200 ms · 2^attempts, teto 5 s); terminal → job já DONE pelo passo.
4. Boot (`start`): `releaseAllLocks` + tick imediato → retoma CREATED/DEBITED/COMPENSATING persistidos.
5. Erro inesperado no loop nunca derruba o processo: loga e continua.
6. `server.ts`: `worker.start()` após `listen`; `stop()` no shutdown antes de `db.close()`; passar `worker.wake` ao handler de RequestTransfer.
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
job-repository.ts: releaseAllLocks, findDueJobs (PENDING + run_after<=now + lock livre), claimJob condicional com lease, rescheduleJob (attempts+1, last_error, limpa lock), unlockJob. worker.ts: createWorker com start (releaseAllLocks + tick imediato + setInterval), wake, stop (para polling e aguarda in-flight com Promise.allSettled), pause/resume/isIdle p/ reset, concorrência 4, in-flight Set local impede duplicar, RETRY_LATER reagenda com backoff 200ms·2^n teto 5s, erro no loop nunca derruba processo. server.ts: worker com logger do app, onAccepted→wake, shutdown worker→app→db. Testes 12 (claim/lease/due/release/reschedule/unlock + 6 de worker incl. recuperação com reconexão, stop aguardando in-flight, pause/resume) via vi.waitFor sem sleeps fixos. Commit 62c7082.
</summary>
