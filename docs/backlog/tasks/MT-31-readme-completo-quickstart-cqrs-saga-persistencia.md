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
updated_at: 2026-10-01T21:47:56.416Z
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
Executado conforme plano (13 seções). Quickstart verificado do zero em /tmp/readme-check (npm ci, db:reset, dev, signin, balance, transferência + reconciliação 125000). Porta do dev vem de PORT/HOST — anotado no README.
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
README 13 seções + verificação from-scratch e reconciliação SQL 125000.
</summary>
