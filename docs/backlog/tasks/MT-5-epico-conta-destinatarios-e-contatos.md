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
updated_at: 2026-10-02T01:03:49.225Z
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
Queries GetMe/GetBalance/GetRecipient/ListContacts e comando AddContact entregues. Consultas usam apenas o accountId/userId da sessão; a única exposição de terceiro é `{accountId,name}` do destinatário. Testes de isolamento em `contacts.test.ts` e `auth-commands.test.ts`.
</summary>
