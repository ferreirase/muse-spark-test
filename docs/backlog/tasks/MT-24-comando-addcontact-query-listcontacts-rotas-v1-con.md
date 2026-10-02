---
id: MT-24
title: Comando AddContact + query ListContacts + rotas /v1/contacts
status: Done
priority: medium
labels:
  - contacts
  - cqrs
  - unit-tests
parent: MT-5
dependencies:
  - MT-22
created_at: 2026-10-01T20:10:27.390Z
updated_at: 2026-10-02T01:03:32.435Z
---

<description>
Destinatários salvos por usuário: comando `addContact` (escrita) e query `listContacts` (leitura) separados, com rotas finas. Requisito B04.
</description>

<context>
- Contrato §6:
  - `GET /v1/contacts` → 200 `{ items: Contact[] }` | 401
  - `POST /v1/contacts` `{nickname, recipientAccountId}` → 201 `Contact` | 404 `RECIPIENT_NOT_FOUND` | 409 `CONTACT_ALREADY_EXISTS` | 422 `SELF_RECIPIENT`
- `Contact = { id, nickname, recipientAccountId, recipientName, createdAt }`.
- Contatos pertencem ao usuário autenticado; ordenar por nickname e, em empate, por ID. Sem edição/exclusão.
- Apelido: trim, 1–60 (normalizador da task de validação). Corpo rejeita propriedades extras.
- Unicidade por dono/destinatário garantida por constraint `UNIQUE(owner_user_id, recipient_account_id)`.
- Reusar `findRecipient` da task GetRecipient.
- Arquivos: `src/modules/contacts/commands/add-contact.ts`, `src/modules/contacts/queries/list-contacts.ts`.
</context>

<plan>
1. `addContact(deps, { ownerUserId, ownerAccountId, nickname, recipientAccountId })`: normalizar apelido; self → 422 `SELF_RECIPIENT`; `findRecipient` null → 404; insert com uuid e `createdAt`; `SQLITE_CONSTRAINT_UNIQUE` → 409 `CONTACT_ALREADY_EXISTS`; retornar Contact com `recipientName`.
2. `listContacts(readDb, ownerUserId)`: JOIN contacts+accounts+users, `ORDER BY nickname, id`. Decidir e documentar em notes a collation (`BINARY` é o default determinístico; `NOCASE` se preferir ordem amigável — manter consistente com o mock do frontend se houver acordo).
3. Rotas com `requireAuth`, body schema `additionalProperties:false`, response schemas.
</plan>

<acceptance>
- [x] Alice lista inicialmente só `contact-bruno` (apelido `Bruno`, recipientName `Bruno Demo`)
- [x] Criar contato válido retorna 201 com `Contact` completo e persiste
- [x] Contato duplicado (mesmo destinatário, apelido diferente) → 409 `CONTACT_ALREADY_EXISTS`
- [x] Própria conta → 422 `SELF_RECIPIENT`; conta inexistente → 404 `RECIPIENT_NOT_FOUND`
- [x] Apelido `"  "` ou com 61 chars após trim → 400 `VALIDATION_ERROR`
- [x] Lista ordenada por nickname e depois id; Bruno não vê contatos de Alice
- [x] Testes unitários passam
</acceptance>

<tests>
`add-contact.test.ts` e `list-contacts.test.ts` (SQLite temporário + seed):
- feliz (Bruno adiciona Carla), trim do apelido
- duplicado, self, inexistente, apelido inválido
- ordenação com empate de nickname resolvido por id
- isolamento entre donos
- listContacts não escreve no banco
</tests>

<summary>
`contacts/commands/add-contact.ts` (normaliza apelido; self 422; inexistente 404; duplicata 409 inclusive corrida via unique constraint) e `contacts/queries/list-contacts.ts` (JOIN, `ORDER BY nickname, id`, BINARY determinístico). Rotas `GET/POST /v1/contacts` com schemas. Testes em `tests/unit/contacts.test.ts` (feliz, trim, duplicado, self, inexistente, ordenação, isolamento entre donos).
</summary>
