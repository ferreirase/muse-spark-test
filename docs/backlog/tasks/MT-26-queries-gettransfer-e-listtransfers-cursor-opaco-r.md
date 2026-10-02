---
id: MT-26
title: Queries GetTransfer e ListTransfers (cursor opaco) + rotas GET /v1/transfers
status: Done
priority: high
labels:
  - transfers
  - cqrs
  - security
  - unit-tests
parent: MT-6
dependencies:
  - MT-25
created_at: 2026-10-01T20:11:08.060Z
updated_at: 2026-10-01T23:17:12.667Z
---

<description>
Read model de transferências: detalhe por ID e histórico paginado por cursor, restritos às transferências **enviadas** pelo usuário autenticado. Requisito B06.
</description>

<context>
- Contrato §6: `GET /v1/transfers/:id` → 200 `Transfer` | 404 `TRANSFER_NOT_FOUND`; `GET /v1/transfers?limit=20&cursor=...` → 200 `TransferPage` | 400 `VALIDATION_ERROR`.
- Histórico e detalhe incluem só transferências enviadas pelo usuário; IDs de outros usuários → 404 (não 403).
- Ordem decrescente por `createdAt` e, em empate, ID; cursor opaco e estável; cursor inválido → 400; `limit` 1–50 (default 20 via `parseLimit`).
- `Transfer` expõe `status` público e `failureCode`; nunca `saga_step`, `in_transit_cents`, `idempotency_key`, `payload_fingerprint`, `last_error`.
- PRD §4: queries não executam Saga nem corrigem estado.
- Índice `transfers(source_account_id, created_at DESC, id DESC)` da migração 001.
- Arquivos: `src/modules/transfers/queries/get-transfer.ts`, `list-transfers.ts`, `src/modules/transfers/cursor.ts`.
</context>

<plan>
1. `encodeCursor({createdAt, id})` = base64url de `JSON.stringify([createdAt, id])`; `decodeCursor(s)` valida forma (array de 2 strings, data ISO válida) ou lança `validationError([{field:'cursor'}])`.
2. `mapTransferRow(row)` único para DTO (JOIN users do destinatário para `recipientName`).
3. `getTransfer(readDb, { sourceAccountId, transferId })`: `WHERE id=? AND source_account_id=?` → DTO ou 404 `TRANSFER_NOT_FOUND`.
4. `listTransfers(readDb, { sourceAccountId, limit, cursor })`: `WHERE source_account_id=? AND (created_at, id) < (?, ?)` (row values) `ORDER BY created_at DESC, id DESC LIMIT limit+1`; se veio limit+1, `nextCursor` = cursor do último item exibido; senão null.
5. Rotas com `requireAuth`, querystring/params schemas e response schemas.
</plan>

<acceptance>
- [x] Detalhe de transferência de outro usuário (inclusive quando ele é o destinatário) → 404 `TRANSFER_NOT_FOUND`
- [x] Histórico só contém transferências enviadas, ordenadas por createdAt desc e id desc
- [x] Paginação percorre todos os itens sem duplicar nem pular, inclusive com `createdAt` idênticos
- [x] Última página tem `nextCursor: null`
- [x] Cursor adulterado/aleatório → 400 `VALIDATION_ERROR` field `cursor`
- [x] `limit` fora de 1–50 → 400
- [x] DTO contém exatamente os campos de `Transfer` do contrato
- [x] Testes unitários passam
</acceptance>

<tests>
`cursor.test.ts` (pura): roundtrip; base64 inválido, JSON inválido, array de tamanho errado, data inválida → erro de validação.
`get-transfer.test.ts` / `list-transfers.test.ts` (SQLite temporário + seed, transferências inseridas direto com clock controlado):
- 45 transferências com 5 timestamps repetidos, limit 20 → páginas 20/20/5, união = conjunto completo, ordem correta
- isolamento remetente × destinatário
- mapeamento de status/failureCode para PENDING, PROCESSING (DEBITED e COMPENSATING), COMPLETED, FAILED
- queries não alteram `total_changes`
</tests>

<summary>
cursor.ts base64url de JSON [createdAt,id] com validação estrita (400 field cursor); getTransfer (WHERE id AND source → 404 TRANSFER_NOT_FOUND para alheios, mesmo destinatário); listTransfers keyset com row values (created_at,id) < (?,?), limit+1 para nextCursor, ordem createdAt DESC id DESC usando índice da migração; DTO expõe só campos públicos (nunca saga_step/in_transit/key/fingerprint). Rotas GET /v1/transfers e /v1/transfers/:id com querystring schema + parseLimit. Testes 13 (cursor 5, get 3, list 4; 45 transferências/5 timestamps → 20/20/5 sem dup/pulo). Commit 7792d97.
</summary>
