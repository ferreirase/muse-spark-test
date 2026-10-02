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
updated_at: 2026-10-01T23:46:59.116Z
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
- [ ] Todas as subtasks deste épico fechadas
- [ ] Nenhuma resposta de erro expõe SQL, hash ou stack trace
</acceptance>

<summary>
Épico concluído: ApiError/requestId/logs (MT-12), validação sem coerção (MT-14), buildApp/server (MT-16) e autenticação/sessões (MT-11, MT-18, MT-20).
</summary>
