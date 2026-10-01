---
id: MT-22
title: Query GetRecipient + rota GET /v1/recipients/:accountId
status: Done
priority: high
labels:
  - contacts
  - cqrs
  - security
  - unit-tests
parent: MT-5
dependencies:
  - MT-14
  - MT-18
created_at: 2026-10-01T20:09:52.225Z
updated_at: 2026-10-01T20:55:17.902Z
---

<description>
Consulta de destinatário por ID exato de conta, retornando somente nome e ID. A mesma função de leitura de destinatário é reutilizada por AddContact e RequestTransfer para validar existência e auto-referência.
</description>

<context>
- Contrato §6: `GET /v1/recipients/:accountId` → 200 `Recipient {accountId, name}` | 404 `RECIPIENT_NOT_FOUND` | 422 `SELF_RECIPIENT`.
- Contrato §6: requer sessão; retorna apenas nome e ID, sem e-mail, saldo ou outros dados.
- Contrato §2: conta destinatária deve existir; usuário não pode usar a própria conta.
- ID exato: sem trim/lowercase do parâmetro.
- Arquivos: `src/modules/contacts/queries/get-recipient.ts`, rota em `src/modules/contacts/routes.ts`.
</context>

<plan>
Executado conforme plano. Rotas verificadas via curl (401/200/422/404).
</plan>

<acceptance>
- [x] `acc-bruno` consultado por Alice → `{accountId:'acc-bruno', name:'Bruno Demo'}` sem outros campos
- [x] Própria conta → 422 `SELF_RECIPIENT`
- [x] ID inexistente ou com caixa diferente (`ACC-BRUNO`) → 404 `RECIPIENT_NOT_FOUND`
- [x] Sem sessão → 401
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/contacts/queries/get-recipient.test.ts` (SQLite temporário + seed): casos feliz, self, inexistente, caixa diferente; checar que o objeto retornado tem exatamente as chaves `accountId` e `name`.
</tests>

<summary>
findRecipient/getRecipient + rota GET /v1/recipients/:accountId. 3 testes, curl 401/200/422/404 ok.
</summary>
