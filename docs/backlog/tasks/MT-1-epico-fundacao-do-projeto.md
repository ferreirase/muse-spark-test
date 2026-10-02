---
id: MT-1
title: "[Épico] Fundação do projeto"
status: Done
priority: high
labels:
  - epic
  - setup
dependencies: []
created_at: 2026-10-01T20:05:20.804Z
updated_at: 2026-10-02T01:03:49.112Z
---

<description>
Base executável do backend Banco Demo: repositório Node.js 24 + TypeScript + Fastify, scripts npm obrigatórios, lockfile fixado, Vitest e configuração tipada por variáveis de ambiente.
</description>

<context>
- Guia: doc-1 (seções 2, 3, 7, 8)
- PRD §2 (stack obrigatória), §9 (scripts e entregáveis)
- Subtasks deste épico listadas via `task_list parent=<este id>`
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] `npm install && npm run typecheck && npm test` passam do zero em clone limpo
</acceptance>

<summary>
Fundação entregue: esqueleto Node 24 + TS strict ESM + Fastify 5 + Vitest, dependências exatas no lockfile, 8 scripts, config tipada. O workspace partiu de um estado limpo (só `docs/` e `.git`) e após `npm install` os comandos `typecheck`, `test` (90 testes) e `build` passaram do zero.
</summary>
