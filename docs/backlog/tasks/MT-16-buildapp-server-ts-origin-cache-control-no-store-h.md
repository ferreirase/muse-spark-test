---
id: MT-16
title: "buildApp + server.ts: Origin, Cache-Control no-store, /health e shutdown
  gracioso"
status: Done
priority: high
labels:
  - http
  - security
  - unit-tests
parent: MT-3
dependencies:
  - MT-12
  - MT-13
created_at: 2026-10-01T20:07:49.322Z
updated_at: 2026-10-01T20:38:44.175Z
---

<description>
Compor a aplicação: `buildApp({ config, db, clock, ... })` registra logger, Ajv sem coerção, error/notFound handlers, cookie, hook de Origin, hook `Cache-Control: no-store` e `GET /health`. `server.ts` é o entrypoint: parseConfig → openDatabase → migrate → buildApp → listen (o worker é plugado na task do worker).
</description>

<context>
- Contrato §4: backend em 127.0.0.1:3001; validar Origin quando presente: aceitar `FRONTEND_ORIGIN`, rejeitar outras em mutações com 403 `ORIGIN_NOT_ALLOWED`; requisições sem Origin (CLI/testes) são aceitas; **não** usar CORS com origem irrestrita + credenciais (não registrar `@fastify/cors`: o frontend usa proxy same-origin).
- Contrato §4: respostas autenticadas e financeiras com `Cache-Control: no-store`; `GET /health` público → `{"status":"ok"}` quando app e SQLite prontos.
- PRD §6: reinício normal não executa reset (server só roda `migrate`, nunca seed/reset).
- Arquivos: `src/app.ts`, `src/server.ts`, `src/http/plugins/origin.ts`, `src/http/plugins/no-store.ts`.
</context>

<plan>
Executado conforme plano. server.ts migra sem seed/reset; dev sobe em 127.0.0.1:3001; sem @fastify/cors. Origin/no-store verificados por teste unitário + revisão de código (sem fastify.inject, proibido).
</plan>

<acceptance>
- [x] POST com `Origin: http://evil.local` retorna 403 `ORIGIN_NOT_ALLOWED`; com origin configurada ou sem Origin passa
- [x] GET com Origin estranha não é bloqueado
- [x] Respostas `/v1/*` (inclusive erros 401) têm `Cache-Control: no-store`
- [x] `GET /health` retorna `{"status":"ok"}` com SQLite aberto
- [x] `@fastify/cors` não está instalado nem registrado
- [x] `npm run dev` sobe em 127.0.0.1:3001 e `server.ts` só migra (não semeia nem reseta)
- [x] Testes unitários passam
</acceptance>

<tests>
`src/http/plugins/origin.test.ts` (função pura `isOriginAllowed`): matriz método × origin (ausente, igual, diferente, `null` literal, variação de porta/esquema).
Sem `fastify.inject` e sem subir servidor (política doc-1 §8).
</tests>

<summary>
buildApp com Ajv estrito, error handler, cookie, Origin, no-store, /health com SELECT 1; server com migrate-only e shutdown gracioso. isOriginAllowed com matriz de testes.
</summary>
