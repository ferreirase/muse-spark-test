# Banco Demo — Backend

Backend local de app bancário fictício, com **CQRS** e **Saga orquestrada e persistida** sobre SQLite. Fastify 5 + TypeScript (ESM estrito) + Node.js 24.

Referências normativas no repo: `docs/contrato-compartilhado.md` (autoridade de rotas/DTOs/erros) e `docs/prd-backend.md` (arquitetura e escopo).

## Requisitos

- Node.js **24 LTS** (`.nvmrc` = `24`; `engines` = `>=24 <25`)
- npm 11+

## Quickstart

```bash
npm install
cp .env.example .env            # opcional: ajuste DATABASE_PATH
npm run db:migrate              # cria o schema
npm run db:seed                 # dados demo (idempotente)
npm run dev                     # http://127.0.0.1:3001
```

O `npm run dev` também roda migração e seed automaticamente no boot (idempotentes), então para uso local basta `npm run dev`. Reiniciar o processo **não** reseta dados; só `npm run db:reset` restaura a fotografia inicial.

Health check público: `GET /health` → `{"status":"ok"}`.

### Credenciais demo

Senha de todas: `Demo123!`.

| Usuário | E-mail | account.id | Saldo |
|---|---|---|---|
| Alice Demo | alice@demo.local | acc-alice | R$ 1.000,00 |
| Bruno Demo | bruno@demo.local | acc-bruno | R$ 250,00 |
| Carla Demo | carla@demo.local | acc-carla | R$ 0,00 |

Alice já tem o contato `Bruno` (`acc-bruno`).

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor com `tsx watch` (migrate + seed no boot) |
| `npm run build` | Compila para `dist/` e copia as migrações `.sql` |
| `npm start` | Roda o build (`node dist/server.js`) |
| `npm run typecheck` | `tsc` sem emitir |
| `npm test` | Vitest (somente testes unitários) |
| `npm run db:migrate` | Aplica migrações versionadas pendentes |
| `npm run db:seed` | Insere o seed (não reaplica se já existir) |
| `npm run db:reset` | Limpa tudo e restaura o seed |

## Configuração

Variáveis em `.env.example` (nada de segredo real no repo):

```
HOST, PORT, DATABASE_PATH, FRONTEND_ORIGIN, COOKIE_SECURE,
LOG_LEVEL, WORKER_POLL_INTERVAL_MS, ENABLE_TEST_CONTROLS, TEST_CONTROL_TOKEN
```

`parseConfig` valida e tipa tudo; `DATABASE_PATH=:memory:` é recusado na aplicação. A sessão tem validade fixa de 24 h (constante, não configurável).

## Arquitetura CQRS

Monólito modular. Cada requisição segue **um** caminho:

- **Comandos** (escrita): `src/modules/*/commands/*` — recebem ports/repositórios de escrita, validam domínio e alteram dados.
- **Queries** (leitura): `src/modules/*/queries/*` — só `SELECT`, mapeiam para DTO e nunca escrevem.
- **Rotas** (`*/routes.ts`): validam transporte (JSON Schema sem coerção), autenticam e chamam o handler. SQL e regras de dinheiro não ficam na rota.
- **Repositórios/read models**: `src/modules/*/repositories.ts` e as queries.

Exemplo de rastreio:

| Rota | Handler |
|---|---|
| `POST /v1/transfers` | `modules/transfers/commands/request-transfer.ts` |
| `GET /v1/transfers` | `modules/transfers/queries/list-transfers.ts` |
| `POST /v1/auth/signup` | `modules/auth/commands/signup.ts` |
| `GET /v1/me` | `modules/auth/queries/get-me.ts` |
| `GET /v1/accounts/me/balance` | `modules/accounts/queries/get-balance.ts` |
| `POST /v1/contacts` | `modules/contacts/commands/add-contact.ts` |
| `GET /v1/contacts` | `modules/contacts/queries/list-contacts.ts` |
| `GET /v1/recipients/:id` | `modules/contacts/queries/get-recipient.ts` |
| `GET /v1/transfers/:id` | `modules/transfers/queries/get-transfer.ts` |

Nenhuma rota POST e GET compartilha um "service CRUD" indiferenciado.

## Saga de transferência

Cada passo é um `db.transaction(...).immediate()` com guarda `UPDATE ... WHERE saga_step = <esperado>`. `changes === 0` significa que o passo já foi aplicado → no-op. Redelivery de job e reexecução são idempotentes.

| `saga_step` | status público | Commit |
|---|---|---|
| `CREATED` | `PENDING` | transfer + job (mesma tx) |
| `DEBITED` | `PROCESSING` | débito condicionado a saldo + ledger `DEBIT` + `in_transit` |
| `COMPLETED` | `COMPLETED` | crédito + ledger `CREDIT` + `in_transit=0` + job `DONE` |
| `COMPENSATING` | `PROCESSING` | falha definitiva de crédito registrada |
| `FAILED` (`INSUFFICIENT_FUNDS`) | `FAILED` | sem efeito financeiro; job `DONE` |
| `FAILED` (`CREDIT_FAILED`) | `FAILED` | reembolso + ledger `COMPENSATION` + `in_transit=0` + job `DONE` |

O ponto de conclusão é o commit do crédito junto com `COMPLETED`. Depois disso a Saga nunca compensa por falha de log, HTTP ou ack.

### Retry e recuperação

- Erros transitórios (`SQLITE_BUSY`, `SQLITE_LOCKED`) → retry por passo (5 tentativas, backoff `25ms·2ⁿ` + jitter). Esgotou → job volta a `PENDING` com `run_after` futuro; a transferência permanece `PROCESSING`.
- Erro definitivo de crédito → `COMPENSATING` → compensação.
- Qualquer erro inesperado é tratado como recuperável (reagenda + log); nunca marca `FAILED` sem compensar.

### Worker durável

`src/modules/worker/worker.ts` faz polling de `jobs` com **lease** (`locked_by`/`locked_until`). No boot, `recoverOnBoot()` libera locks vencidos. O worker é parado de forma graciosa no shutdown e durante `/__test/reset`.

## Persistência

Arquivo SQLite configurável (`DATABASE_PATH`, nunca `:memory:` em execução). Pragmas: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`. Migrações versionadas em `src/db/migrations` (registradas em `schema_migrations`).

`ledger_entries` é auditável: triggers impedem `CREDIT` após `COMPENSATION` (e vice-versa) para a mesma transferência; constraints garantem ≤1 `DEBIT`, ≤1 `CREDIT`, ≤1 `COMPENSATION` por transferência.

### Invariantes e reconciliação

Sem depósitos/taxas/resets: `SUM(accounts.balance_cents) + SUM(transfers.in_transit_cents) = 125000`. Signups somam zero (conta com saldo 0). Estado terminal ⇒ `in_transit_cents = 0`.

Reconciliação por conta: `saldo_atual = saldo_do_seed + Σ ledger_da_conta`. Verificação:

```sql
SELECT account_id, SUM(amount_cents) FROM ledger_entries GROUP BY account_id;
```

## Segurança

- Senha: `scrypt` (N=16384, r=8, p=1) com salt aleatório; nunca plaintext/SHA puro. Não é logada.
- Sessão: token aleatório de 32 bytes, persistido só como hash SHA-256; cookie `bank_session` HttpOnly, SameSite=Lax, Path=/, Secure configurável, 24 h. Logout revoga no servidor.
- Origin validada em mutações (403 `ORIGIN_NOT_ALLOWED`); sem CORS permissivo. `Cache-Control: no-store` nas respostas autenticadas/financeiras.
- JSON Schema sem coerção de tipos para dinheiro; `additionalProperties: false` em signup/signin/contato/transferência.
- SQL sempre parametrizado; queries filtram pelo dono da sessão (404 para dados de terceiros).
- Logs estruturados (Pino) com requestId; cookie/authorization redigidos. Erros internos não vazam stack nem SQL.

## Testes

Política do projeto (PRD §8): **somente unitários**, chamando as funções diretamente. Sem `fastify.inject`, servidor HTTP, e2e, browser ou spawn de processo. Unidades transacionais usam SQLite temporário em arquivo (nunca `:memory:`).

```bash
npm test
```

Cobrem: config, normalizadores, hash/sessão, erros, origin, cursor, fingerprint, retry, passos da Saga, orquestrador, worker, comandos/queries de auth/contatos/transferências. Cenários: sucesso, saldo insuficiente, replay idempotente, conflito de payload, disputa por saldo, falha de crédito com compensação e recuperação reabrindo a conexão sobre o mesmo arquivo.

## Controles de falha

Ver `docs/test-controls.md`. Resumo: `ENABLE_TEST_CONTROLS=true` + `TEST_CONTROL_TOKEN`, header `X-Test-Control-Token`. Rotas `POST /__test/reset`, `POST /__test/faults` (`FAIL_CREDIT_ONCE`, `PAUSE_AFTER_DEBIT`) e `POST /__test/release`. Com a flag desligada as rotas dão 404; token inválido dá 403.

## OpenAPI

`openapi.json` documenta as rotas `/v1` e `/health`. A API de teste é documentada à parte.

## Limitações (escopo declarado)

- Não há frontend neste repositório.
- Sem testes de integração HTTP, e2e, carga ou reinício real de processo (decisão de escopo, PRD v1.1 §8). A recuperação é verificada fechando e reabrindo a conexão sobre o mesmo arquivo.
- Uma instância de API + um worker local; sem cluster, broker externo, microsserviços ou event sourcing.
- Sem taxas, câmbio, cheque especial, depósito, saque, recuperação de senha, MFA/KYC ou Pix real.
