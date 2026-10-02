# Relatório de execução — Banco Demo backend

Data: 02/10/2026 · Node 24.21.0 · npm 11.19.0 · SO Linux

Comandos realmente executados neste ambiente e seus resultados. Distingue verificação automatizada de checagens manuais.

## 1. Setup

| Comando | Resultado |
|---|---|
| `node --version` | `v24.21.0` |
| `npm --version` | `11.19.0` |
| `npm install --save-exact fastify @fastify/cookie better-sqlite3` | 54 pacotes, 0 vulnerabilidades |
| `npm install -D --save-exact typescript tsx vitest @types/node @types/better-sqlite3` | 43 pacotes, 0 vulnerabilidades |
| `npm install --save-exact fastify-plugin` | ok |
| `node -e "require('better-sqlite3')..."` | SQLite nativo carregou (`{x:1}`) |

## 2. Verificação automatizada (make-or-break)

| Comando | Resultado |
|---|---|
| `npx tsc -p tsconfig.json` | exit 0, sem erros (inclui `src` e `tests`) |
| `npx vitest run` | **9 arquivos, 72 testes, 72 passaram** |
| `npm run build` | `tsc` + cópia das migrações; `dist/db/migrations/001_init.sql` presente |
| `node dist/db/cli.js migrate` (DATABASE_PATH=/tmp) | `[db:migrate] applied 1_init` |
| `npm run db:seed` | `[db:seed] inserted 3 demo users` |
| Validação de `openapi.json` | JSON válido |

Arquivos de teste e foco: `config`, `validation`, `password`/`session-token`, `errors`/`origin`, `cursor`/`fingerprint`, `retry`, `auth-commands`, `contacts`, `transfers` (passos da Saga, orquestrador, worker, recuperação, concorrência).

## 3. Checagem manual (smoke test, não faz parte da suíte)

Servidor real (`node --import tsx src/server.ts`) com arquivo SQLite real; requisições via `curl`. Resultados observados:

| Cenário | Resultado |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `POST /v1/auth/signup` | `201` + `Set-Cookie` HttpOnly |
| `POST /v1/auth/signin` (Alice) | `200` |
| `GET /v1/me`, `/accounts/me/balance` | `200`, saldo 100000 |
| `GET /v1/recipients/acc-bruno` | `{accountId, name}` sem e-mail/saldo |
| `GET /v1/contacts` | contato `Bruno` |
| `POST /v1/transfers` (10000) | `202 PENDING` → worker → `COMPLETED`; saldo 90000 |
| Replay mesma `Idempotency-Key` + payload | `200`, mesmo ID |
| Mesma chave, payload diferente | `409 IDEMPOTENCY_CONFLICT` |
| Transferir para si | `422 SELF_RECIPIENT` |
| Destinatário inexistente | `404 RECIPIENT_NOT_FOUND` |
| Saldo insuficiente (após débito) | `202` → `FAILED` / `INSUFFICIENT_FUNDS`, sem ledger |
| Propriedade extra no corpo | `400 VALIDATION_ERROR` |
| Origin estranha em mutação | `403 ORIGIN_NOT_ALLOWED` |
| Sem sessão | `401 UNAUTHENTICATED` |
| Fault `FAIL_CREDIT_ONCE` | `FAILED` / `CREDIT_FAILED`; saldo restaurado; ledger `SEM CREDIT` |
| Fault `PAUSE_AFTER_DEBIT` | `PROCESSING`, saldo debitado |
| `POST /__test/release` | `204` → `COMPLETED` |
| Reinício **real** do processo durante pausa | transferência retomada e concluída, sem duplicar débito/crédito |

A checagem de reinício real do processo acima foi manual, de validação do autor. **Não** integra a suíte automatizada.

## 4. Escopo declarado (não executado)

Por decisão de escopo (PRD v1.1 §8), não foram feitos e não fazem parte da nota:

- testes de integração HTTP (`fastify.inject` ou servidor real) na suíte;
- testes end-to-end, de carga ou de browser;
- teste automatizado de recuperação com **reinício real de processo** (a suíte cobre recuperação fechando/reabrindo a conexão sobre o mesmo arquivo).

A implementação inclui os scripts `dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `db:seed` e `db:reset`, além de `.env.example`, `openapi.json` e `docs/test-controls.md`.
