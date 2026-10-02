---
id: MT-2
title: "[Épico] Persistência SQLite"
status: Done
priority: high
labels:
  - epic
  - db
dependencies: []
created_at: 2026-10-01T20:05:20.897Z
updated_at: 2026-10-02T01:03:49.150Z
---

<description>
Arquivo SQLite configurável por DATABASE_PATH, conexão com pragmas corretos, migrações versionadas com todas as constraints de integridade/dinheiro, seed reproduzível do contrato e reset explícito.
</description>

<context>
- Guia: doc-1 §4 (schema), §6 (invariantes)
- PRD §6 (modelo de persistência mínimo)
- Contrato §3 (seed)
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] `npm run db:reset` gera arquivo novo com seed e soma de saldos = 125000
</acceptance>

<summary>
SQLite configurável, pragmas corretos, migração 001 com constraints/triggers, seed idempotente e reset explícito. `db:reset` restaura 3 usuários/3 contas/1 contato e soma de saldos 125000 (coberto por `invariantTotal` nos testes e por smoke manual).
</summary>
