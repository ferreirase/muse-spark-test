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
updated_at: 2026-10-02T01:03:15.607Z
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
1. `npm init -y`; setar `"type": "module"`, `"engines": {"node": ">=24 <25"}`, `"private": true`.
2. `npm install --save-exact fastify @fastify/cookie better-sqlite3`.
3. `npm install --save-exact -D typescript tsx vitest @types/node @types/better-sqlite3`.
4. `tsconfig.json`: `strict`, `module`/`moduleResolution` = `NodeNext`, `target` ES2023, `outDir dist`, `rootDir src`, `noUncheckedIndexedAccess`.
5. Scripts: `dev`=`tsx watch src/server.ts`; `build`=`tsc -p tsconfig.json`; `start`=`node dist/server.js`; `typecheck`=`tsc --noEmit`; `test`=`vitest run`; `db:migrate`=`tsx src/db/cli.ts migrate`; `db:seed`=`tsx src/db/cli.ts seed`; `db:reset`=`tsx src/db/cli.ts reset`.
6. `vitest.config.ts` com `environment: 'node'`, `include: ['src/**/*.test.ts','tests/**/*.test.ts']`, `pool: 'forks'` (better-sqlite3 nativo).
7. `.nvmrc` = `24`; `.gitignore` com `node_modules`, `dist`, `data/*.sqlite*`, `.env`.
8. `src/server.ts` mínimo (Fastify ouvindo em 127.0.0.1:3001) só para validar `dev`/`build`/`start`; será substituído na task de buildApp.
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
Setup concluído. `package.json` ESM, `engines >=24 <25`, os 8 scripts obrigatórios e dependências exatas. TypeScript strict/NodeNext, Vitest com `src/**` e `tests/**`. `.nvmrc`=24, `.gitignore`, `.env.example`. Build (`tsconfig.build.json` + `scripts/copy-assets.mjs`) copia as migrações `.sql` para `dist`. Evidência: `npx tsc` sem erros; `npx vitest run` 11 arquivos/90 testes; `npm run build` OK.
</summary>
