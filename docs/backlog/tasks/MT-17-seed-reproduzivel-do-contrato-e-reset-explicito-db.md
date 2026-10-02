---
id: MT-17
title: Seed reproduzível do contrato e reset explícito (db:seed, db:reset)
status: Done
priority: high
labels:
  - db
  - seed
  - unit-tests
parent: MT-2
dependencies:
  - MT-15
  - MT-11
created_at: 2026-10-01T20:08:48.662Z
updated_at: 2026-10-02T01:03:32.011Z
---

<description>
Funções `seed(db, clock)` e `resetDatabase(db, clock)` reutilizadas pelos scripts CLI e pela rota `POST /__test/reset`. Seed é idempotente e nunca reaplica saldo; reset apaga tudo (inclusive ledger, jobs, faults, sessões) e restaura a fotografia inicial.
</description>

<context>
- Contrato §3 (normativo):
  | user.id | nome | e-mail | account.id | saldo |
  |---|---|---|---|---|
  | user-alice | Alice Demo | alice@demo.local | acc-alice | 100000 |
  | user-bruno | Bruno Demo | bruno@demo.local | acc-bruno | 25000 |
  | user-carla | Carla Demo | carla@demo.local | acc-carla | 0 |
  Senha de todos: `Demo123!`. Contato inicial de Alice: id `contact-bruno`, apelido `Bruno`, destinatário `acc-bruno`. Sem transferências.
- Contrato §3: seed não reaplica saldo nem apaga operações ao reiniciar; só reset explícito restaura.
- PRD §6: seeds não exigem lançamentos de abertura no ledger; soma inicial = 125000.
- PRD §9: arquivo SQLite gerado por migrate/seed; não versionar `.sqlite` preenchido.
- Ledger é imutável por trigger (task da migração 001): reset precisa de mecanismo explícito (ex.: dentro da transação, `DROP TRIGGER` → `DELETE` → recriar trigger com o mesmo SQL exportado da migração).
- Arquivos: `src/db/seed.ts`, `src/db/reset.ts`, `src/db/cli.ts`.
</context>

<plan>
1. Constante `SEED` com usuários/contas/contato acima; `createdAt` fixo `2026-10-01T00:00:00.000Z` para reprodutibilidade.
2. `seed(db)`: calcular hash de `Demo123!` com `hashPassword` (async, antes da transação); dentro de `transaction().immediate()`: `INSERT ... ON CONFLICT(id) DO NOTHING` para users, accounts, contacts. Conta existente **não** tem saldo alterado.
3. `resetDatabase(db)`: em uma transação: apagar `test_faults`, `jobs`, `ledger_entries` (com mecanismo para trigger), `transfers`, `contacts`, `sessions`, `accounts`, `users` (ordem por FK); depois inserir o seed.
4. `cli.ts`: subcomandos `migrate`, `seed` (migra antes), `reset` (migra + reset). Log de uma linha com resultado.
5. Exportar `INITIAL_TOTAL_CENTS = 125000` e `SEED_BALANCES` para reconciliação e testes.
</plan>

<acceptance>
- [x] `npm run db:reset` produz exatamente os 3 usuários, 3 contas, 1 contato do contrato e soma de saldos 125000
- [x] Rodar `db:seed` após alterar saldos/criar transferências não altera nada existente
- [x] `resetDatabase` remove sessões, contatos extras, transferências, ledger, jobs e faults e restaura saldos
- [x] Signin com `alice@demo.local` / `Demo123!` funciona após seed (verificar via `verifyPassword` no teste)
- [x] Trigger de imutabilidade do ledger continua ativo após reset
- [x] Testes unitários passam
</acceptance>

<tests>
`src/db/seed.test.ts` com SQLite temporário em arquivo:
- seed em banco vazio → dados exatos do contrato
- seed 2× → sem duplicata, sem erro
- alterar saldo de acc-alice e rodar seed → saldo alterado preservado
- reset após inserir sessão/contato/transfer/ledger/job/fault → tudo limpo e seed restaurado; trigger de ledger ainda bloqueia DELETE depois
</tests>

<summary>
`db/seed.ts` idempotente (users/accounts/contacts fixos do contrato, senha `Demo123!` hasheada, total 125000, contato `contact-bruno`), `db/reset.ts` limpa faults/jobs/ledger/transfers/contacts/sessions/accounts/users usando `ledger_reset_guard` para vencer o trigger append-only e re-semeia. `db/cli.ts` expõe migrate/seed/reset. Seed não reaplica saldo nem apaga operações. Testes de schema/reset em `tests/unit/db.test.ts` e signin pós-seed em `tests/unit/auth-commands.test.ts`.
</summary>
