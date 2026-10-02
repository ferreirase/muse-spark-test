---
id: MT-12
title: Erros padronizados (ApiError), requestId, logs estruturados e error handler
status: Done
priority: high
labels:
  - http
  - security
  - observability
  - unit-tests
parent: MT-3
dependencies:
  - MT-9
created_at: 2026-10-01T20:06:35.045Z
updated_at: 2026-10-02T01:03:23.147Z
---

<description>
Classe `AppError(code, statusCode, message, details?)`, catálogo de códigos do contrato e função pura `toApiErrorResponse(error, requestId)` que converte qualquer erro (domínio, validação do Fastify/Ajv, JSON malformado, desconhecido) no DTO `ApiError` com status correto. Configurar requestId e logger Pino com redaction.
</description>

<context>
- Contrato §5 `ApiError = { error: { code, message, details? }, requestId }`.
- Contrato §6: 400 `VALIDATION_ERROR` com `details` por campo; 401 `UNAUTHENTICATED`; 403 `ORIGIN_NOT_ALLOWED`; 404 `RECIPIENT_NOT_FOUND`/`TRANSFER_NOT_FOUND`; 409 `EMAIL_ALREADY_EXISTS`/`CONTACT_ALREADY_EXISTS`/`IDEMPOTENCY_CONFLICT`; 422 `SELF_RECIPIENT`/`SELF_TRANSFER`; 401 `INVALID_CREDENTIALS`; 500 `INTERNAL_ERROR`.
- PRD §7: logs estruturados com requestId, transferId, etapa e erro; nunca registrar senha nem cookie; mensagens ao cliente não vazam SQL, hash ou stack.
- Arquivos: `src/shared/errors.ts`, `src/http/plugins/errors.ts`, opções do logger em `src/app.ts`.
</context>

<plan>
1. `AppError extends Error` com `code`, `statusCode`, `details?`; helpers `validationError(details)`, `notFound(code)`, etc.
2. Catálogo `ErrorCode` como union de strings do contrato + `NOT_FOUND` (rota inexistente).
3. `toApiErrorResponse(err, requestId): { statusCode, body }`:
   - `AppError` → seus dados;
   - erro com `validation` (Ajv do Fastify) → 400 `VALIDATION_ERROR`, `details` = `[{ field, message }]` derivado de `instancePath`/`params.missingProperty`/`params.additionalProperty` e `validationContext` (body/querystring/headers/params);
   - `FST_ERR_CTP_*` / JSON inválido → 400 `VALIDATION_ERROR`;
   - resto → 500 `INTERNAL_ERROR` com mensagem genérica.
4. Fastify: `genReqId` com `randomUUID`, `requestIdHeader: false` (não confiar em header do cliente), retornar header `x-request-id`.
5. Logger: `redact` para `req.headers.cookie`, `req.headers.authorization`, `req.headers["x-test-control-token"]`, `res.headers["set-cookie"]`, `*.password`, `*.passwordHash`.
6. `setErrorHandler` loga erro 5xx com stack (só no log) e responde via `toApiErrorResponse`; `setNotFoundHandler` → 404 `NOT_FOUND`.
</plan>

<acceptance>
- [x] Toda resposta de erro segue exatamente o shape `ApiError` com `requestId`
- [x] Erros Ajv viram 400 `VALIDATION_ERROR` com `details[].field` apontando o campo (ex.: `amountCents`, `email`, `idempotency-key`)
- [x] Erro desconhecido vira 500 `INTERNAL_ERROR` sem stack, SQL ou mensagem original no corpo
- [x] Logs nunca contêm cookie, senha, hash ou token de teste (redaction configurada)
- [x] Testes unitários passam
</acceptance>

<tests>
`src/shared/errors.test.ts` (função pura `toApiErrorResponse`, sem servidor):
- AppError 409 preserva code/status/message
- objeto de erro Ajv simulado (required, additionalProperties, type, pattern) → details corretos
- erro `SqliteError` com mensagem contendo SQL → 500 genérico sem vazar texto
- erro FST_ERR_CTP_INVALID_JSON_BODY → 400
</tests>

<summary>
`shared/errors.ts`: `AppError(code,status,message,details)`, catálogo de todos os códigos do contrato + `FORBIDDEN`, `mapError` e `mapFastifyValidation` que convertem AppError/Ajv/erros HTTP <500/desconhecidos em `ApiError` (500 genérico sem vazar SQL/stack). Error handler Fastify, `genReqId` randomUUID com `requestIdHeader:false`, header `x-request-id`, logger Pino com redaction de cookie, authorization, `x-test-control-token`, set-cookie e campos `password*`. Testes em `tests/unit/errors.test.ts`. Desvio: funções nomeadas `mapError`/`mapFastifyValidation` em vez de `toApiErrorResponse`.
</summary>
