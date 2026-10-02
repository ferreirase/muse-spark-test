---
id: doc-1
title: Guia de implementação — Banco Demo backend
type: specification
tags:
  - backend
  - arquitetura
  - cqrs
  - saga
  - testes
created_at: 2026-10-01T20:04:53.044Z
updated_at: 2026-10-01T20:18:07.876Z
---

# Guia de implementação — Banco Demo backend

Leia antes de qualquer task deste backlog. Fontes normativas (no repo):

- `docs/contrato-compartilhado.md` — **autoridade** para rotas, DTOs, cookie, seed, códigos de erro e controles `/__test`.
- `docs/prd-backend.md` (v1.1) — arquitetura (CQRS, Saga), persistência, segurança, política de testes, entregáveis.

Em conflito, o contrato vence. Não implementar frontend.

## 1. Workflow do agente no backlog

1. `task_update` status → `In Progress`.
2. `block_set <plan>` antes de codar (pode refinar o plan sugerido na task).
3. `block_append <notes>` com descobertas e desvios.
4. Marcar cada item de `<acceptance>` só quando verificado (comando executado).
5. `block_set <summary>` + `task_close`. Fechar o épico quando todas as subtasks fecharem.

## 2. Stack decidida

| Item | Escolha | Motivo |
|---|---|---|
| Runtime | Node.js 24 LTS (`engines: ">=24 <25"`, `.nvmrc` = `24`) | máquina do dev já usa 24.x |
| Linguagem | TypeScript strict, ESM | PRD |
| HTTP | Fastify 5 + `@fastify/cookie` | PRD |
| SQLite | `better-sqlite3` | transações síncronas `.immediate()`, maduro; `node:sqlite` ainda experimental |
| Validação | JSON Schema nativo do Fastify (Ajv) sem coerção | PRD §7, sem lib extra |
| Hash senha | `node:crypto` `scrypt` + salt aleatório | stdlib |
| IDs | `crypto.randomUUID()` (seed usa IDs fixos) | stdlib |
| Logs | Pino nativo do Fastify | stdlib do framework |
| Testes | Vitest | rápido, TS nativo |
| Dev | `tsx watch` | |

Versões fixadas no `package-lock.json` (instalar com `npm install --save-exact`).

## 3. Layout (monólito modular, CQRS visível)

```
src/
  config.ts                 # parseConfig(env) tipado
  server.ts                 # entrypoint: migrate → buildApp → worker.start → listen
  app.ts                    # buildApp(deps): registra plugins e módulos
  db/
    connection.ts           # openDatabase(path) + pragmas
    migrate.ts              # runner de migrações versionadas
    migrations/001_init.sql
    seed.ts / reset.ts      # funções + scripts CLI
  shared/
    errors.ts               # AppError(code,status,details) + mapeador
    dto.ts                  # tipos TS dos DTOs do contrato
    validation.ts           # normalizadores puros (nome, email, nota, ...)
    schemas.ts              # JSON Schemas reutilizáveis (DTOs, ApiError)
    clock.ts                # now() injetável
  http/
    plugins/                # requestId/log, error handler, origin, no-store, auth
  modules/
    auth/        commands/ queries/ repositories.ts routes.ts password.ts session-token.ts
    accounts/    queries/ routes.ts
    contacts/    commands/ queries/ routes.ts
    transfers/   commands/ queries/ saga/ routes.ts cursor.ts
    worker/      job-repository.ts worker.ts
    test-controls/ routes.ts faults.ts
tests/unit/...              # ou *.test.ts ao lado do módulo
```

Regra CQRS: rota POST → `commands/*` (handler recebe ports de escrita). Rota GET → `queries/*` (handler recebe read model, só SELECT, retorna DTO). Nenhum handler de query escreve, nenhuma rota chama um "service CRUD" genérico. SQL fica em repositórios/read models, não nas rotas.

## 4. Schema sugerido (migração 001)

- `users(id PK, name, email UNIQUE, password_hash, created_at, updated_at)`
- `accounts(id PK, user_id UNIQUE FK, currency CHECK(currency='BRL'), balance_cents INTEGER CHECK(typeof(balance_cents)='integer' AND balance_cents>=0), updated_at)`
- `sessions(id PK, token_hash UNIQUE, user_id FK, created_at, expires_at, revoked_at NULL)`
- `contacts(id PK, owner_user_id FK, recipient_account_id FK, nickname, created_at, UNIQUE(owner_user_id, recipient_account_id))`
- `transfers(id PK, source_account_id FK, recipient_account_id FK, amount_cents CHECK(1..100000000), note NULL, status CHECK IN(PENDING,PROCESSING,COMPLETED,FAILED), failure_code CHECK IN(INSUFFICIENT_FUNDS,CREDIT_FAILED) NULL, saga_step CHECK IN(CREATED,DEBITED,COMPENSATING,COMPLETED,FAILED), in_transit_cents CHECK(>=0), attempts, last_error, idempotency_key, payload_fingerprint, created_at, updated_at, UNIQUE(source_account_id, idempotency_key), CHECK(source_account_id <> recipient_account_id))`
- `ledger_entries(id PK, transfer_id FK, account_id FK, type CHECK IN(DEBIT,CREDIT,COMPENSATION), amount_cents (DEBIT negativo), created_at, UNIQUE(transfer_id, type))` + trigger que impede COMPENSATION se existe CREDIT e vice-versa. Nunca DELETE/UPDATE em ledger fora do reset de teste.
- `jobs(id PK, transfer_id UNIQUE FK, status CHECK IN(PENDING,DONE), run_after, attempts, locked_by, locked_until, last_error, created_at, updated_at)`
- `test_faults(id PK, source_account_id, idempotency_key, mode CHECK IN(FAIL_CREDIT_ONCE,PAUSE_AFTER_DEBIT), armed_at, consumed_at NULL, transfer_id NULL, UNIQUE(source_account_id, idempotency_key))`
- `schema_migrations(version PK, applied_at)`

## 5. Saga — mapa de estados

| saga_step | status público | Commit que leva até ele |
|---|---|---|
| CREATED | PENDING | POST: transfer + job, mesma tx |
| DEBITED | PROCESSING | débito condicionado + ledger DEBIT + in_transit = amount |
| COMPLETED | COMPLETED | crédito + ledger CREDIT + in_transit = 0 + job DONE |
| COMPENSATING | PROCESSING | falha definitiva de crédito registrada |
| FAILED (INSUFFICIENT_FUNDS) | FAILED | sem débito; job DONE |
| FAILED (CREDIT_FAILED) | FAILED | reembolso + ledger COMPENSATION + in_transit = 0 + job DONE |

Cada passo: `db.transaction(...).immediate()` com guarda `UPDATE transfers ... WHERE id=? AND saga_step=<esperado>`; `changes===0` → passo já aplicado, rollback, no-op. Isso torna redelivery idempotente.

Erros:
- **Transitório**: `SQLITE_BUSY`, `SQLITE_LOCKED` → retry por passo (ex.: 5 tentativas, backoff 25ms·2ⁿ + jitter). Esgotou → job volta a PENDING com `run_after` futuro, status inalterado.
- **Definitivo de crédito**: `CreditFailedError` (fault `FAIL_CREDIT_ONCE` ou destinatário inexistente) → COMPENSATING → compensação.
- Qualquer outro erro inesperado: tratar como recuperável (reagendar + log), **nunca** marcar FAILED sem compensar.

## 6. Invariantes (verificar em testes unitários)

- `SUM(balance_cents) + SUM(in_transit_cents) = 125000` partindo do seed.
- ≤1 DEBIT, ≤1 CREDIT, ≤1 COMPENSATION por transferência; CREDIT e COMPENSATION mutuamente exclusivos.
- Estado terminal ⇒ `in_transit_cents = 0`.
- Compensação soma o valor de volta; nunca restaura snapshot.
- Saldo = saldo do seed + Σ ledger da conta (reconciliação no README).

## 7. Configuração (`.env.example`)

```
HOST=127.0.0.1
PORT=3001
DATABASE_PATH=./data/bank.sqlite
FRONTEND_ORIGIN=http://127.0.0.1:3000
COOKIE_SECURE=false
LOG_LEVEL=info
WORKER_POLL_INTERVAL_MS=200
ENABLE_TEST_CONTROLS=false
TEST_CONTROL_TOKEN=
```

Sessão: 24 h fixas (constante, não configurável).

## 8. Política de testes (decisão do dono do projeto, 01/10/2026)

Normativa no PRD v1.1 §8 e §9. Resumo:

**Somente testes unitários** de unidades que executam ações: services, command/query handlers, passos da Saga, orquestrador, worker, funções puras (validação, hash, cursor, fingerprint, retry, mapeamento de erro, origin).

- Teste unitário chama a função diretamente. **Proibido**: `fastify.inject`, servidor HTTP, `child_process`/spawn, browser, testes e2e ou de integração entre camadas HTTP.
- Unidades cujo comportamento É a transação SQL (repositórios, handlers, passos da Saga) podem usar SQLite temporário em arquivo (`fs.mkdtempSync` + `migrate`), fechado e apagado no `afterEach`. Nunca `:memory:`.
- Recuperação: testar a função de recuperação fechando a conexão e abrindo uma nova instância sobre o mesmo arquivo (sem spawn de processo).
- Relógio, sleep e geração de IDs injetáveis para determinismo. Nada de sleeps fixos para esperar worker.

O relatório final (MT-32) declara explicitamente que integração, e2e e recuperação com reinício real de processo não foram feitos por decisão de escopo (PRD v1.1 §9).
