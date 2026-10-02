---
id: MT-14
title: "Validação de entrada: normalizadores de domínio e JSON Schemas sem coerção"
status: Done
priority: high
labels:
  - http
  - validation
  - security
  - unit-tests
parent: MT-3
dependencies:
  - MT-12
created_at: 2026-10-01T20:07:12.594Z
updated_at: 2026-10-01T22:47:35.931Z
---

<description>
Centralizar as regras de formato do contrato em duas camadas: (1) JSON Schemas de request/response para as rotas Fastify, com Ajv configurado sem coerção e sem remover propriedades extras; (2) normalizadores puros de domínio (trim, lowercase, nota vazia → null, parse do `limit`) reutilizados pelos command handlers.
</description>

<context>
- Contrato §2: nome trim 2–80; e-mail trim+lowercase, formato válido, ≤254; senha 8–72 sem trim; apelido trim 1–60; nota opcional trim ≤140, vazia após trim → null; `amountCents` inteiro 1..100000000; `currency` não é aceito no POST.
- Contrato §6: corpos de signup/signin/contato/transferência rejeitam propriedades extras (400); `limit` inteiro 1–50, cursor opcional; `Idempotency-Key` obrigatório `^[A-Za-z0-9._:-]{8,128}$`.
- PRD §7: validar request **e response** no Fastify sem coerção indevida de strings para dinheiro (`"100"` em `amountCents` deve ser 400).
- Fastify por padrão usa Ajv com `coerceTypes: 'array'` e `removeAdditional: true` — precisa sobrescrever.
- Arquivos: `src/shared/validation.ts`, `src/shared/schemas.ts`, `src/shared/dto.ts`.
</context>

<plan>
1. `src/shared/dto.ts`: tipos TS exatamente como contrato §5.
2. Opção do Fastify: `ajv: { customOptions: { coerceTypes: false, removeAdditional: false, allErrors: true, useDefaults: false } }` (aplicar em buildApp; exportar o objeto daqui).
3. Schemas de body com `additionalProperties: false`: signup, signin, addContact, requestTransfer (`amountCents: {type:'integer', minimum:1, maximum:100000000}`, `note: {type:['string','null']}` opcional).
4. Limites de tamanho que dependem de trim (nome, apelido, nota) são checados no normalizador, não só no schema (schema aceita string; normalizador aplica trim e mede).
5. Querystring de `GET /v1/transfers`: `limit` como `{type:'string', pattern:'^[0-9]{1,3}$'}` e `cursor` string; `parseLimit(raw)` converte e valida 1–50 (default 20 quando ausente).
6. Header `idempotency-key` com o pattern do contrato e `required`.
7. Schemas de **response** para cada DTO (User, Account, AuthResult, Balance, Recipient, Contact, Transfer, TransferPage, ApiError) com `additionalProperties: false` — serialização descarta campos internos (hash, saga_step, in_transit).
8. Normalizadores puros que lançam `validationError([{field,message}])`: `normalizeName`, `normalizeEmail` (regex simples `^[^\s@]+@[^\s@]+\.[^\s@]+$` após trim+lowercase, ≤254), `checkPassword` (8–72, sem trim), `normalizeNickname`, `normalizeNote`, `parseLimit`.
</plan>

<acceptance>
- [x] Ajv do Fastify configurado com `coerceTypes:false` e `removeAdditional:false`
- [x] `amountCents: "100"`, `10.5`, `0`, `100000001` são rejeitados com 400 e `details[].field = amountCents`
- [x] Propriedade extra (ex.: `sourceAccountId`, `balanceCents`) em qualquer corpo obrigatório é rejeitada com 400
- [x] Nota `"   "` vira `null`; nota com 141 chars após trim é 400
- [x] Senha com espaços nas pontas é preservada byte a byte
- [x] `parseLimit` aceita 1–50, default 20, rejeita `0`, `51`, `abc`, `1.5`
- [x] Schemas de response existem para todos os DTOs do contrato
- [x] Testes unitários passam
</acceptance>

<tests>
`src/shared/validation.test.ts` (funções puras):
- cada normalizador: caso feliz, limites exatos (min, max, min-1, max+1), trim, lowercase do e-mail, e-mail com 255 chars
- `normalizeNote`: undefined/null/""/"   " → null; trim aplicado
- `parseLimit`: default, limites, inválidos
`src/shared/schemas.test.ts` (Ajv standalone com as MESMAS opções do app, sem servidor):
- schema de transferência rejeita string numérica, float, extra prop, `currency`
- pattern de Idempotency-Key: 7 chars, 129 chars, caractere `/` ou espaço rejeitados; `alice-bruno-001` aceito
</tests>

<summary>
dto.ts com todos os tipos do contrato §5; ajvOptions (coerceTypes:false, removeAdditional:false, allErrors, useDefaults:false); bodies signup/signin/addContact/requestTransfer com additionalProperties:false e amountCents integer 1..1e8 (sem currency); header idempotency-key com pattern do contrato; querystring limit/cursor; response schemas de todos os DTOs (descartam saga_step, in_transit, hash). Normalizadores puros lançam AppError 400 com field: nome 2–80, email trim+lower ≤254, senha 8–72 sem trim, apelido 1–60, nota→null, parseLimit 1–50 default 20, checkIdempotencyKey. Testes 16 (validation 12 + schemas 10... total files). Commit db8e19b.
</summary>
