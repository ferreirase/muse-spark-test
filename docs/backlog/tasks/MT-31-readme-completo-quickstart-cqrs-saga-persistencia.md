---
id: MT-31
title: README completo (quickstart, CQRS, Saga, persistência, retries, testes,
  limitações)
status: Done
priority: medium
labels:
  - docs
parent: MT-8
dependencies:
  - MT-30
created_at: 2026-10-01T20:12:13.396Z
updated_at: 2026-10-02T01:03:41.926Z
---

<description>
README na raiz que permite a um avaliador sem contexto instalar, rodar, testar e entender a arquitetura, com todas as seções exigidas pelo PRD.
</description>

<context>
- PRD §9: README com quickstart, credenciais demo, CQRS, diagrama ou tabela da Saga, persistência, retries, comandos de teste, controles de falha e limitações; comando de instalação e versão de Node.
- PRD §4: explicar onde estão os caminhos POST→command handler e GET→query handler.
- PRD §6: descrever como reconciliar soma dos saldos e ledger a partir dos saldos do seed.
- PRD §1: documentar escolhas e limitações.
- Política de testes só unitários: doc-1 §8.
</context>

<plan>
Seções:
1. **Requisitos**: Node 24 (`.nvmrc`), toolchain nativa se o prebuild do better-sqlite3 falhar.
2. **Quickstart**: `npm ci` → `cp .env.example .env` → `npm run db:reset` → `npm run dev`; `curl` de signin + balance.
3. **Credenciais demo**: tabela do seed (alice/bruno/carla, `Demo123!`, IDs, saldos).
4. **Scripts**: os 8 scripts com uma linha cada.
5. **CQRS**: tabela rota → arquivo de rota → command/query handler → repositório/read model (ex.: `POST /v1/transfers` → `modules/transfers/commands/request-transfer.ts`; `GET /v1/transfers/:id` → `modules/transfers/queries/get-transfer.ts`).
6. **Saga**: tabela de estados (doc-1 §5) + diagrama Mermaid de estados; ponto de não retorno; idempotência por passo; invariantes.
7. **Persistência**: tabelas, constraints/triggers relevantes, pragmas, `DATABASE_PATH`, migrações, seed vs reset.
8. **Reconciliação**: `saldo(conta) = saldo_seed(conta) + Σ ledger(conta)` e `Σ saldos + Σ in_transit = 125000`, com SQL pronto para copiar.
9. **Worker e retries**: polling, wake, lease, backoff, recuperação no boot, metas 5 s/10 s.
10. **Controles de teste**: link para `docs/test-controls.md`, como ligar flag/token.
11. **Testes**: `npm test`; o que é coberto; declaração explícita: apenas unitários por decisão do dono; integração/e2e/recuperação com kill de processo não implementados.
12. **Segurança**: scrypt, sessão hash, cookie, Origin, no-store, redaction.
13. **Limitações**: um worker por arquivo, sem expiração de idempotency key, sem rotação de sessão, etc.
</plan>

<acceptance>
- [x] Todas as 13 seções presentes
- [x] Quickstart executado do zero em diretório limpo e funcionando exatamente como escrito
- [x] Tabela CQRS aponta para arquivos que existem
- [x] SQL de reconciliação executado contra um banco após algumas transferências e conferindo 125000
- [x] Declaração explícita do escopo de testes (só unitários)
</acceptance>

<tests>
Sem testes de código. Verificação manual dos comandos do README, registrada em notes.
</tests>

<summary>
`README.md` com requisitos (Node 24), quickstart, credenciais demo, scripts, tabela CQRS rota→arquivo, tabela de estados da Saga, persistência/pragmas/constraints, SQL de reconciliação, worker/retries (5s/10s), controles de teste, política de testes só unitários, segurança e limitações. Verificação manual dos comandos e do SQL de reconciliação registrada em `docs/relatorio-execucao.md`.
</summary>
