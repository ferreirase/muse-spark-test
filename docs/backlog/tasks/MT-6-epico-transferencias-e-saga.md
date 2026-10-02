---
id: MT-6
title: "[Épico] Transferências e Saga"
status: Done
priority: high
labels:
  - epic
  - transfers
  - saga
  - worker
  - cqrs
dependencies: []
created_at: 2026-10-01T20:05:21.259Z
updated_at: 2026-10-02T01:03:49.266Z
---

<description>
Núcleo avaliado do benchmark: POST de transferência idempotente que persiste operação + job durável e responde 202; worker local que executa a Saga orquestrada em commits locais separados (débito, crédito, compensação), com retry de falhas transitórias, recuperação após reinício e consultas de detalhe/histórico. Requisitos B05–B10.
</description>

<context>
- PRD §5 inteiro (estados, regras, invariantes), §8 (5 s até terminal, 10 s para recuperar)
- Contrato §5 (Transfer, TransferPage, semântica de balanceCents), §6 (rotas e idempotência)
- Guia doc-1 §5 e §6
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] Invariante `Σ saldos + Σ em trânsito = 125000` verificada por teste unitário após cenários de sucesso, falha e compensação
- [x] Nenhuma única transação SQL cobre débito e crédito juntos
</acceptance>

<summary>
Transferências e Saga entregues: POST idempotente com job durável, worker com lease/polling/recuperação, passos em commits separados, retry de transitórios, compensação e queries de detalhe/histórico. Invariante `Σ saldos + Σ em trânsito = 125000` verificada em sucesso, insuficiente, compensação e recuperação; débito e crédito nunca na mesma transação.
</summary>
