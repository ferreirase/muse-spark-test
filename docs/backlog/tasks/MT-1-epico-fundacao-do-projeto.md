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
updated_at: 2026-10-01T22:59:52.035Z
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
- [ ] Todas as subtasks deste épico fechadas
- [ ] `npm install && npm run typecheck && npm test` passam do zero em clone limpo
</acceptance>

<summary>
Épico concluído: repositório com Node 24 + TS strict ESM + Fastify 5 + Vitest (MT-9) e configuração tipada por env com .env.example (MT-10).
</summary>
