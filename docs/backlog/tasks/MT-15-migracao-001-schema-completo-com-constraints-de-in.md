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
updated_at: 2026-10-01T20:35:11.821Z
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
Executado conforme plano. Decisão sobre reset (ledger imutável): MT-17 fará reset via DROP TABLE + migrate limpo — triggers de imutabilidade não bloqueiam DROP. Teste de unicidade de idempotency refeito como INSERT duplicado direto.
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
001_init.sql STRICT com todas as tabelas, CHECKs de dinheiro/enums, triggers de sequência e imutabilidade do ledger. 8 testes de constraint, typecheck ok.
</summary>
