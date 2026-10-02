---
id: MT-15
title: "Migração 001: schema completo com constraints de integridade e dinheiro"
status: Done
priority: high
labels:
  - db
  - saga
  - unit-tests
parent: MT-2
dependencies:
  - MT-13
created_at: 2026-10-01T20:07:49.245Z
updated_at: 2026-10-01T22:49:36.019Z
---

<description>
Criar `src/db/migrations/001_init.sql` com todas as tabelas do modelo mínimo do PRD e as constraints que garantem as invariantes da Saga no próprio banco (não só no código).
</description>

<context>
- Schema sugerido completo: doc-1 §4 (users, accounts, sessions, contacts, transfers com progresso da Saga, ledger_entries, jobs, test_faults).
- PRD §6: e-mail único normalizado; conta 1:1 com usuário; saldo inteiro; sessão com hash/expiração/revogação; contato único por dono/destinatário; transfer com idempotency key + fingerprint; ledger com unicidade de passo e auditável.
- PRD §5 invariantes: ≤1 débito/crédito/compensação por transferência garantido por constraint; crédito e compensação nunca coexistem; saldo inteiro não negativo.
- Datas armazenadas como TEXT ISO 8601 UTC com milissegundos (`new Date().toISOString()`), geradas pela aplicação (clock injetável), para ordenação lexicográfica correta.
</context>

<plan>
1. Tabelas com `STRICT` (SQLite ≥ 3.37) para impedir tipo errado em colunas de dinheiro.
2. `accounts.balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0)`; `currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL')`; `user_id UNIQUE REFERENCES users(id)`.
3. `transfers`: CHECKs de faixa de `amount_cents` (1..100000000), `source <> recipient`, enums de `status`/`failure_code`/`saga_step`, `in_transit_cents >= 0`, coerência `(status='FAILED') = (failure_code IS NOT NULL)`; `UNIQUE(source_account_id, idempotency_key)`.
4. `ledger_entries`: `UNIQUE(transfer_id, type)`; CHECK de sinal (`DEBIT < 0`, `CREDIT > 0`, `COMPENSATION > 0`); triggers `BEFORE INSERT` que fazem `RAISE(ABORT, ...)` se inserir COMPENSATION com CREDIT existente ou CREDIT com COMPENSATION existente, e se inserir CREDIT/COMPENSATION sem DEBIT existente; triggers `BEFORE UPDATE`/`BEFORE DELETE` que abortam (ledger imutável — o reset de teste usa `DROP`/recriação ou desliga via tabela de controle; decidir e anotar em notes).
5. `jobs.transfer_id UNIQUE`; índice `(status, run_after)`.
6. Índices: `transfers(source_account_id, created_at DESC, id DESC)` para histórico; `contacts(owner_user_id, nickname, id)`; `sessions(token_hash)` já unique.
7. `test_faults` com `UNIQUE(source_account_id, idempotency_key)` e enum de `mode`.
</plan>

<acceptance>
- [x] Todas as tabelas de doc-1 §4 existem após `migrate`
- [x] Inserir saldo negativo ou não inteiro em `accounts` falha
- [x] Segundo DEBIT (ou CREDIT, ou COMPENSATION) para a mesma transferência falha por constraint
- [x] COMPENSATION após CREDIT (e vice-versa) falha por trigger
- [x] CREDIT sem DEBIT prévio falha por trigger
- [x] UPDATE/DELETE em `ledger_entries` falha (exceto mecanismo documentado do reset)
- [x] Mesma `(source_account_id, idempotency_key)` duas vezes falha
- [x] FK inválida falha (foreign_keys ligado)
- [x] Testes unitários passam
</acceptance>

<tests>
`src/db/schema.test.ts` com SQLite temporário em arquivo + `migrate`, inserindo linhas diretamente e esperando `SqliteError` com código de constraint:
- cada CHECK de dinheiro e enum
- unicidade de ledger por passo e exclusividade CREDIT × COMPENSATION
- imutabilidade do ledger
- unicidade de e-mail, de conta por usuário, de contato por dono/destinatário, de idempotency key por conta
</tests>

<summary>
001_init.sql STRICT: users (email unique), accounts (saldo int>=0, currency=BRL, user_id unique), sessions (token_hash unique, revogação), contacts (unique dono/destinatário), transfers (faixa 1..1e8, self-block, enums status/failure/saga_step, coerência FAILED↔failure_code, in_transit>=0, UNIQUE(source,key)), ledger_entries (UNIQUE(transfer,type), sinais DEBIT<0, triggers: CREDIT×COMPENSATION exclusivos, CREDIT/COMPENSATION exigem DEBIT, imutável em UPDATE/DELETE), jobs (transfer unique, idx status/run_after), test_faults. Testes 10 cobrindo todas as constraints com SqliteError esperado. Reset decidido: recria schema (DROP+migrate+seed), nunca apaga ledger. db:migrate idempotente e dist verificados. Commit 73c0d5a.
</summary>
