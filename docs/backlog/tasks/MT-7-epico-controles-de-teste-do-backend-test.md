---
id: MT-7
title: "[Épico] Controles de teste do backend (/__test)"
status: Done
priority: medium
labels:
  - epic
  - test-controls
dependencies: []
created_at: 2026-10-01T20:05:21.342Z
updated_at: 2026-10-01T21:55:49.670Z
---

<description>
Rotas de avaliação determinística exigidas pelo contrato: reset, injeção de falha (FAIL_CREDIT_ONCE, PAUSE_AFTER_DEBIT) e release, isoladas por flag ENABLE_TEST_CONTROLS e header X-Test-Control-Token.
</description>

<context>
- Contrato §8 (controles de avaliação)
- PRD §7 (controles isolados por flag e token)
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] Com flag desligada, nenhuma rota /__test existe (404) e nenhuma checagem de fault roda na Saga
</acceptance>

<summary>
Subtasks MT-28/29 fechadas; 404 sem flag verificado via curl.
</summary>
