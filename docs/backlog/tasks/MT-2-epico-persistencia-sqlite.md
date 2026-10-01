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
updated_at: 2026-10-01T21:53:32.657Z
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
Subtasks MT-13/15/17 fechadas; db:reset verificado com soma 125000.
</summary>
