---
id: MT-9
title: Setup do repositório Node 24 + TypeScript + Fastify + Vitest
status: Done
priority: high
labels:
  - setup
parent: MT-1
dependencies: []
created_at: 2026-10-01T20:05:52.023Z
updated_at: 2026-10-01T20:25:53.088Z
---

<description>
Criar o esqueleto executável do backend: `package.json` com todos os scripts obrigatórios do PRD, dependências fixadas no lockfile, TypeScript strict em ESM, Vitest configurado e `.gitignore`. Sem código de domínio ainda; os scripts `db:*` podem apontar para arquivos criados em tasks seguintes.
</description>

<context>
- PRD §2: Node.js + TypeScript + Fastify obrigatórios; fixar versões no lockfile; documentar versão de Node.
- PRD §9: scripts `dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:reset`.
- Stack decidida em doc-1 §2: Node 24 LTS, Fastify 5, `@fastify/cookie`, `better-sqlite3`, Vitest, `tsx`.
- Diretório atual só tem `docs/`. Não é repositório git ainda: rodar `git init` se o dono pedir commits.
</context>

<plan>
Executado conforme plano da task: package.json manual (npm init rejeita `=` no nome do diretório), deps com --save-exact, tsconfig sem vitest.config no include (rootDir), sanity test.
</plan>

<acceptance>
- [x] `package-lock.json` gerado e todas as dependências com versão exata (sem `^`/`~`)
- [x] `npm run typecheck` e `npm run build` passam
- [x] `npm test` roda Vitest (pode haver um teste sanity trivial que será removido depois)
- [x] Os 8 scripts obrigatórios existem no `package.json`
- [x] `engines.node` e `.nvmrc` declaram Node 24
</acceptance>

<tests>
Nenhum teste unitário de domínio nesta task (só scaffolding). Não criar e2e/integração — ver política em doc-1 §8.
</tests>

<risks>
- `better-sqlite3` precisa de binário nativo compatível com Node 24; se o prebuild falhar, registrar em notes a toolchain necessária (python3, make, g++) para o README.
</risks>

<summary>
Scaffolding criado: Node 24 engines/.nvmrc, TS strict ESM, Fastify 5 + cookie + better-sqlite3, Vitest forks. typecheck, build e test passam.
</summary>
