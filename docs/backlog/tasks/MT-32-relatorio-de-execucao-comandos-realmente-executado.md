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
updated_at: 2026-10-01T23:46:53.297Z
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
docs/relatorio-execucao.md com a bateria real executada no clone limpo (node -v, npm ci 1.3s, typecheck 0 erros, build, 29 arquivos/203 testes ~2.4s, db:reset, npm start + curl /health 200, roteiro curl signin→202 PENDING→replay 200 mesmo id→COMPLETED no 1º poll <0.3s→saldos 90000/35000), mapeamento B01–B10→arquivos de teste e seção Não executado (integração HTTP, e2e, kill real de processo, carga) com o motivo (política §8). Linkado no README §11. Commit 3e85f6d.
</summary>
