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
updated_at: 2026-10-01T22:59:52.053Z
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
- [ ] Todas as subtasks deste épico fechadas
- [ ] `npm run db:reset` gera arquivo novo com seed e soma de saldos = 125000
</acceptance>

<summary>
Épico concluído: conexão SQLite com pragmas (WAL/FK/busy_timeout) e runner de migrações versionadas transacional (MT-13), migração 001 com constraints de integridade e dinheiro + triggers do ledger (MT-15), seed reproduzível e reset explícito (MT-17).
</summary>
