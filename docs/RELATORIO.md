# Relatório de execução — 01/10/2026

Comandos efetivamente executados na entrega final (nada aqui é previsto — tudo rodou).

## Ambiente

- `node -v` → `v24.21.0`
- `npm -v` → `11.19.0`
- better-sqlite3 12.4.1: prebuild funcionou sem toolchain extra.

## Comandos finais (diretório do projeto, 01/10/2026 ~23:49 UTC)

| Comando | Resultado |
|---|---|
| `npm run typecheck` | passou, sem erros |
| `npm run build` | passou (`dist/` + migrações copiadas) |
| `npm test` | **30 arquivos, 132 testes, todos passando** (~2s) |
| `npm run db:reset` (DATABASE_PATH=./data/final.sqlite) | `Reset concluído. Soma dos saldos: 125000 centavos.` |
| `node dist/server.js` + `curl /health` | `{"status":"ok"}` |
| signin Alice + `POST /v1/transfers` (Idempotency-Key `final-001`, 10000) + `GET /v1/transfers/<id>` após ~3s | `COMPLETED null` |

Roteiros manuais com `curl` executados ao longo do desenvolvimento (não são testes
automatizados): signup/signin/signout (201/200/204, 400/409), me/balance (401/DTO/no-store),
recipient (200/404/422), contacts (201/409/422), transfers (202 replay 200, 409, 400, 422),
lista/detalhe (404 isolamento, 400 cursor/limit), `/__test/reset` (403/204) e flag desligada (404),
faults FAIL (FAILED/CREDIT_FAILED) e PAUSE → PROCESSING → release → COMPLETED, kill simulado
por abort + nova conexão. Arquivos `.sqlite` de verificação foram apagados (`data/` vazio).

## Cobertura B01–B10 → testes unitários

| Requisito | Arquivo(s) de teste |
|---|---|
| B01 signup persistido | `src/modules/auth/commands/auth-commands.test.ts` |
| B02 signin/signout | idem + `session-repository.test.ts` |
| B03 saldo | `src/modules/accounts/queries/get-balance.test.ts` |
| B04 contatos | `src/modules/contacts/commands/add-contact.test.ts` |
| B05 transferir | `saga/steps.test.ts`, `transfers/commands/request-transfer.test.ts`, `worker/worker.test.ts` |
| B06 acompanhar | `transfers/queries/transfer-queries.test.ts` |
| B07 idempotência | `request-transfer.test.ts` (replay, conflito, 10× concorrente) |
| B08 concorrência | `saga/steps.test.ts` (disputa por saldo) |
| B09 compensação | `saga/steps.test.ts`, `saga/orchestrator.test.ts`, `test-controls/faults.test.ts` |
| B10 recuperação | `saga/orchestrator.test.ts` + `worker/worker.test.ts` (nova conexão no mesmo arquivo) |

## Não executado (decisão de escopo, PRD v1.1 §8–§9)

- Testes de integração HTTP (`fastify.inject`, servidor real em teste).
- Testes e2e e browser.
- Recuperação com kill real de processo OS (coberta por reabertura de conexão no mesmo arquivo).
- Testes de carga.

Motivo: decisão do dono do projeto — entregar somente testes unitários.
