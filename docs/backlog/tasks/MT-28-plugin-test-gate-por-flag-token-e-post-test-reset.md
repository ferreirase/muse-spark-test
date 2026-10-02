---
id: MT-28
title: "Plugin /__test: gate por flag/token e POST /__test/reset"
status: Done
priority: medium
labels:
  - test-controls
  - security
  - unit-tests
parent: MT-7
dependencies:
  - MT-17
  - MT-27
created_at: 2026-10-01T20:11:40.593Z
updated_at: 2026-10-01T23:28:30.672Z
---

<description>
Registrar as rotas `/__test/*` somente quando `ENABLE_TEST_CONTROLS=true`, protegidas pelo header `X-Test-Control-Token`, e implementar o reset que pausa o worker, restaura o seed e retoma.
</description>

<context>
- Contrato §8: flag desligada → rotas retornam 404; token inválido → 403; não fazem parte da API do frontend.
- `POST /__test/reset` → 204: restaura o seed e limpa sessões, contatos adicionais, transferências, Saga, trabalhos e ledger; aguarda worker ocioso ou pausa-o antes do reset.
- PRD §7: controles isolados por flag e token; nunca logar o token (redaction já configurada).
- Reusar `resetDatabase` da task de seed/reset e `worker.pause/resume/stop` da task do worker; sagas pausadas por `PAUSE_AFTER_DEBIT` devem ser abortadas (AbortSignal do orquestrador) antes do reset para não escreverem depois.
- Arquivos: `src/modules/test-controls/routes.ts`, `src/modules/test-controls/guard.ts`.
</context>

<plan>
1. Função pura `checkTestControlAccess({ enabled, expectedToken, providedToken }): 'NOT_FOUND' | 'FORBIDDEN' | 'OK'` com comparação `timingSafeEqual` (tamanhos diferentes → FORBIDDEN).
2. `buildApp` só registra o plugin quando a flag está ligada (flag desligada → notFound handler natural → 404); hook do plugin usa a função e lança 403 `FORBIDDEN`.
3. `resetAll({ db, worker, pauseRegistry })`: `worker.pause()` → abortar pausas pendentes → aguardar `worker.isIdle()` → `resetDatabase(db)` → `worker.resume()`; sempre `resume` em `finally`.
4. Rota `POST /__test/reset` → 204.
</plan>

<acceptance>
- [x] Flag desligada: `POST /__test/reset` → 404 e plugin não registrado
- [x] Flag ligada sem header ou com token errado → 403
- [x] Token correto → 204 e banco igual ao seed (soma 125000, só `contact-bruno`, sem transferências/ledger/jobs/sessões/faults)
- [x] Reset com saga em andamento/pausada não deixa escrita da saga depois do reset
- [x] Worker volta a processar novas transferências após o reset
- [x] Testes unitários passam
</acceptance>

<tests>
`guard.test.ts` (pura): matriz enabled × token (ausente, errado, tamanho diferente, correto).
`reset-all.test.ts` (SQLite temporário + seed + worker com runSaga fake bloqueado): resetAll aborta/aguarda, banco volta ao seed, worker processa nova transferência depois.
</tests>

<summary>
guard.ts checkTestControlAccess puro (timingSafeEqual, NOT_FOUND/FORBIDDEN/OK); pause-registry.ts com abortAll; resetAll pausa worker → aborta sagas → aguarda idle com teto → resetDatabase → resume sempre no finally; plugin Fastify encapsulado registrado SÓ com flag ligada (404 natural quando off), gate onRequest por X-Test-Control-Token (normaliza array) → 403 FORBIDDEN. Worker ganhou pauseRegistry + hooks e cria AbortController por job (signal passado ao orquestrador). server.ts compartilha registry entre app e worker. Testes 6 (guard 4 + resetAll 2 com saga bloqueada e falha no reset) + verificação inject 7/7 (404 off, 403 sem/errado, 204, limpeza, no-store). Também corrigidos 5 erros de tipo que o wrapper escondia desde MT-21. Commits e1598d4+f4dfa40.
</summary>
