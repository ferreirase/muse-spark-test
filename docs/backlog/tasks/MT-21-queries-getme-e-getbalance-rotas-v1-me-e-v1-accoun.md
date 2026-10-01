---
id: MT-21
title: Queries GetMe e GetBalance + rotas /v1/me e /v1/accounts/me/balance
status: Done
priority: high
labels:
  - accounts
  - auth
  - cqrs
  - unit-tests
parent: MT-5
dependencies:
  - MT-18
created_at: 2026-10-01T20:09:52.130Z
updated_at: 2026-10-01T20:53:08.937Z
---

<description>
Query handlers (lado de leitura do CQRS) que retornam DTOs do usuário autenticado: `getMe` → `AuthResult`, `getBalance` → `Balance`. Só SELECT, sem efeitos colaterais.
</description>

<context>
- Contrato §6: `GET /v1/me` → 200 `AuthResult` | 401; `GET /v1/accounts/me/balance` → 200 `Balance` | 401.
- `Balance = { accountId, currency:'BRL', balanceCents, updatedAt }`.
- Contrato §5: `balanceCents` é o saldo disponível atual (já desconta débitos em processamento; volta após compensação) — é a coluna `accounts.balance_cents` diretamente.
- PRD B03: saldo real da conta autenticada, com centavos, sem dados de outra conta.
- PRD §4: queries não criam registros, não executam Saga, não corrigem saldos.
- Arquivos: `src/modules/auth/queries/get-me.ts`, `src/modules/accounts/queries/get-balance.ts`, `src/modules/accounts/routes.ts`. Read model recebe `db` e usa apenas statements SELECT.
</context>

<plan>
Executado conforme plano. Rotas verificadas via curl: 401 sem cookie, DTOs exatos, no-store.
</plan>

<acceptance>
- [x] `getMe` retorna exatamente os campos do `AuthResult` do contrato
- [x] `getBalance` retorna `balanceCents` inteiro com centavos (ex.: 10001) e `updatedAt` ISO
- [x] Usa apenas o accountId da sessão; não existe forma de consultar outra conta
- [x] Handlers de query não executam INSERT/UPDATE/DELETE
- [x] Ambas as rotas protegidas por `requireAuth` e com `Cache-Control: no-store`
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/accounts/queries/get-balance.test.ts` e `src/modules/auth/queries/get-me.test.ts` (SQLite temporário + seed):
- Alice → 100000; após UPDATE manual para 10001 → 10001
- getMe de Bruno não contém dados de Alice; shape exato (chaves esperadas, sem extras)
- `total_changes` do db inalterado após chamar as queries (prova de que não escrevem)
</tests>

<summary>
getMe/getBalance só SELECT + rotas protegidas. 2 testes (shape exato, total_changes inalterado). curl: 401/DTOs/no-store ok.
</summary>
