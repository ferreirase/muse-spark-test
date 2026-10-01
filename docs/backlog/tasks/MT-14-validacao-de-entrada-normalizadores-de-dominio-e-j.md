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
updated_at: 2026-10-01T20:33:33.600Z
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
Executado conforme plano. Desvios: ajv adicionado como devDep (MT-9 listou só ferramentas, não libs de validação; Ajv standalone é usado só nos testes — no app a validação é do Fastify). Import ESM de Ajv com NodeNext precisou de wrapper de tipo.
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
DTOs, normalizadores puros, schemas request/response + AJV_OPTIONS sem coerção. 12 testes (validation 9, schemas 3), typecheck ok.
</summary>
