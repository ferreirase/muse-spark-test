---
id: MT-5
title: "[Épico] Conta, destinatários e contatos"
status: Done
priority: high
labels:
  - epic
  - accounts
  - contacts
  - cqrs
dependencies: []
created_at: 2026-10-01T20:05:21.174Z
updated_at: 2026-10-01T21:54:59.380Z
---

<description>
Consultas de usuário/saldo da conta autenticada, consulta de destinatário por ID e contatos salvos (criar e listar). Requisitos B03 e B04.
</description>

<context>
- Contrato §5 (DTOs Balance, Recipient, Contact), §6 (rotas e erros)
- PRD §3 B03/B04, §4 (queries GetMe, GetBalance, GetRecipient, ListContacts; comando AddContact)
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] Nenhuma query retorna dados de conta/usuário que não pertençam ao solicitante (exceto nome+ID do destinatário)
</acceptance>

<summary>
Subtasks MT-21/22/24 fechadas; isolamento verificado (404 para outras contas).
</summary>
