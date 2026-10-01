# Relatório de execução — Banco Demo v1 (backend)

Data: 02/10/2026 · Node v24.21.0 · npm 11.19.0 · Linux x64
Branch de entrega: `impl/banco-demo-v1` (clone limpo via `git archive`).

Comandos abaixo foram **realmente executados** no clone limpo; saídas resumidas
do que saiu no terminal. Nada aqui é previsão.

## 1. Bateria de entrega (clone limpo)

| Comando | Resultado | Observações |
|---|---|---|
| `node -v` | `v24.21.0` | conforme `.nvmrc`/`engines` |
| `npm ci` | OK em ~1,3 s | lockfile exato; melhor-sqlite3 13.0.3 com binário pré-compilado (sem rebuild) |
| `npm run typecheck` | OK (0 erros) | ~0,4 s |
| `npm run build` | OK | `dist/` + migrações `.sql` copiadas (~0,4 s) |
| `npm test` | **29 arquivos / 203 testes passaram** | ~2,4 s (pool forks) |
| `npm run db:reset` | `database reset to seed in ./data/bank.sqlite` | 3 usuários, 3 contas, 1 contato, soma 125000 |
| `npm start` | OK — `Server listening at http://127.0.0.1:3001` | boot com migrate (sem seed/reset no boot) |
| `curl http://127.0.0.1:3001/health` | `200 {"status":"ok"}` | |
| `curl -X POST /v1/auth/signin` (Alice) | `200` AuthResult + `Set-Cookie: bank_session=...` | HttpOnly/SameSite=Lax/Path=/Max-Age=86400 |
| `curl -X POST /v1/transfers` (+`Idempotency-Key: demo-run-0001`) | `202` Transfer `PENDING` | |
| replay da mesma chave + payload | `200`, **mesmo id**, sem nova transferência | idempotência B07 |
| polling `GET /v1/transfers/:id` | `COMPLETED` no **1º poll (< 0,3 s)** | meta ≤ 5 s atendida com folga |
| saldos pós-transferência | Alice `90000`, Bruno `35000` | exatamente −10000/+10000 |
| reinício do processo (`npm start` de novo) | dados persistidos; boot sem reset/re-seed | PRD §6 |

Saída integral da bateria: `npm test` →
`Test Files 29 passed (29) / Tests 203 passed (203)`.

## 2. Roteiro manual executado (runtime, não é teste automatizado)

Sinin → transferência → replay → polling até terminal → saldos das duas
contas, tudo via `curl` contra `node dist/server.js` (evidência acima).
Marcado como **execução manual**; a suíte automatizada é só unitária (§4).

## 3. Coberto por teste unitário (mapeamento B01–B10)

| Req. | Cenário | Onde está o teste |
|---|---|---|
| B01 signup persistido atômico | user+conta+sessão em 1 tx; duplicado; falha no meio não deixa órfão | `src/modules/auth/commands/auth.test.ts` |
| B02 signin/signout | hash/salt scrypt, sessão persistida, expiração (fronteira), revogação, idempotência do signout | `password.test.ts`, `session-repository.test.ts`, `auth.test.ts` |
| B03 saldo real com centavos | DTO exato, updatedAt, isolamento | `get-balance.test.ts`, `get-me.test.ts` |
| B04 contatos | criar/listar, duplicado 409, self 422, inexistente 404, isolamento, ordenação | `list-contacts.test.ts` (addContact) |
| B05 transferir 202 PENDING → worker | comando cria transfer+job na mesma tx; saga até COMPLETED | `request-transfer.test.ts`, `steps.test.ts`, `worker.test.ts` |
| B06 acompanhar | detalhe 404 de alheio, histórico paginado sem duplicatas/lacunas, failureCode | `get-transfer`/`list-transfers.test.ts`, `cursor.test.ts` |
| B07 idempotência | replay (mesma chave/payload) serial e `Promise.all` 10×; conflito 409; escopo por conta; corrida de UNIQUE | `request-transfer.test.ts`, `fingerprint.test.ts` |
| B08 concorrência | dois débitos concorrentes disputando saldo: só um passa | `steps.test.ts` (disputa), guardas `schema.test.ts` |
| B09 compensação | fault FAIL_CREDIT_ONCE e destinatário ausente → reembolso + FAILED/CREDIT_FAILED; compensação não é snapshot | `steps.test.ts`, `faults.test.ts`, `orchestrator.test.ts` |
| B10 recuperação | retomada por estado (CREATED/DEBITED/COMPENSATING), **fechando a conexão e reabrindo o mesmo arquivo**, locks antigos no boot, pausa consumida não bloqueia | `orchestrator.test.ts`, `worker.test.ts`, `faults.test.ts` |

Também cobertos (transversais): config, validação sem coerção, erros→DTO,
migrações/constraints/triggers, seed/reset, retry/backoff, guard de test
controls, openapi vs rotas.

## 4. Não executado (decisão de escopo — PRD v1.1 §8/§9)

Política do dono do projeto (01/10/2026): **somente testes unitários** de
unidades que executam ações. Por isso **não foram feitos**:

- **Testes de integração HTTP** (`fastify.inject` ou servidor real dentro da
  suíte) e **e2e/browser** — o comportamento HTTP foi verificado apenas pela
  execução manual com `curl` registrada no §1/§2.
- **Recuperação com reinício real de processo** (kill -9 do SO + restart):
  substituída em teste pelo fechamento da conexão e reabertura do mesmo
  arquivo (equivalente em nível unitário) e pela fault determinística
  `PAUSE_AFTER_DEBIT` (ver `docs/test-controls.md`).
- **Testes de carga/performance.**

Casos "previstos" apenas no nível de desenho (não automatizados): latência
exata do worker sob carga, comportamento com múltiplos processos apontando o
mesmo arquivo SQLite (limitação documentada no README §13).
