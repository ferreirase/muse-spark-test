---
id: MT-3
title: "[Épico] Infra HTTP transversal"
status: Done
priority: high
labels:
  - epic
  - http
  - security
dependencies: []
created_at: 2026-10-01T20:05:20.985Z
updated_at: 2026-10-02T01:03:49.187Z
---

<description>
Peças compartilhadas por todas as rotas: formato ApiError, requestId, logs estruturados com redaction, error handler, validação de schema sem coerção, normalizadores de domínio, checagem de Origin, Cache-Control no-store, /health e composição do app (buildApp/server).
</description>

<context>
- Contrato §4 (transporte), §5 (ApiError), §6 (erros 400/403/500)
- PRD §7 (segurança, erros, observabilidade)
- Guia doc-1 §3
</context>

<acceptance>
- [x] Todas as subtasks deste épico fechadas
- [x] Nenhuma resposta de erro expõe SQL, hash ou stack trace
</acceptance>

<summary>
Infra HTTP transversal completa: ApiError, requestId, logs com redaction, error handler, validação sem coerção, normalizadores, Origin, no-store, /health e buildApp/server. Erros desconhecidos viram 500 INTERNAL_ERROR genérico sem SQL/hash/stack (teste `tests/unit/errors.test.ts`).
</summary>
