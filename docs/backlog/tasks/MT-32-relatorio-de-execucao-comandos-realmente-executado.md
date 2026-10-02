---
id: MT-32
title: "Relatório de execução: comandos realmente executados e resultados"
status: Done
priority: low
labels:
  - docs
  - report
parent: MT-8
dependencies:
  - MT-31
created_at: 2026-10-01T20:12:24.834Z
updated_at: 2026-10-02T01:03:41.946Z
---

<description>
Relatório curto `docs/relatorio-execucao.md` com os comandos efetivamente rodados na entrega final e suas saídas resumidas, separando o que foi executado do que só foi previsto.
</description>

<context>
- PRD v1.1 §9: relatório curto com comandos realmente executados e seus resultados; distinguir testes executados de casos apenas previstos; declarar explicitamente que integração, e2e e recuperação com reinício real de processo não foram feitos por decisão de escopo.
- PRD v1.1 §8: política de testes só unitários (resumo em doc-1 §8).
- Nunca afirmar algo que não foi executado.
</context>

<plan>
1. Em clone limpo: `node -v`, `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm run db:reset`, `npm start` + `curl /health`.
2. Roteiro manual opcional com `curl` (signin Alice → POST transfer → GET até COMPLETED) se o dono quiser evidência de runtime; marcar como execução manual, não teste automatizado.
3. Tabela: comando | data | resultado (passou/falhou, nº de testes, tempo).
4. Seção "Coberto por teste unitário" mapeando B01–B10 para arquivos de teste.
5. Seção "Não executado" listando: integração HTTP, e2e, recuperação com kill de processo real, carga — com o motivo (decisão de escopo).
6. Linkar o relatório no README.
</plan>

<acceptance>
- [x] Todos os comandos listados foram realmente executados e as saídas conferem
- [x] Mapeamento B01–B10 → testes unitários presente
- [x] Seção "Não executado" lista explicitamente integração/e2e/recuperação com processo e o motivo
- [x] Relatório linkado no README
</acceptance>

<tests>
Sem testes de código.
</tests>

<summary>
`docs/relatorio-execucao.md` com comandos realmente executados (node/npm, install, typecheck, build, vitest 11 arquivos/90 testes, db:seed, dist migrate, validação do openapi), evidência de smoke manual via curl (health, signup/signin, transfer saga, idempotência, 404/409/422/400/403/401, faults, release, reinício real do processo), seção de não executado (integração/e2e/recuperação automatizada com kill) e link no README.
</summary>
