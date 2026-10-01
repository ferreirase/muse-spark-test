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
updated_at: 2026-10-01T20:29:43.113Z
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
Executado conforme plano. Função pura testada sem servidor (fastify.inject proibido).
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
AppError + catálogo do contrato, toApiErrorResponse pura (Ajv→400, resto→500 genérico), plugins requestId/errorHandler, redaction de segredos. 9 testes, typecheck ok.
</summary>
