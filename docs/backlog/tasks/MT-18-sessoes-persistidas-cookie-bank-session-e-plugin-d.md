---
id: MT-18
title: Sessões persistidas, cookie bank_session e plugin de autenticação
status: Done
priority: high
labels:
  - auth
  - security
  - unit-tests
parent: MT-4
dependencies:
  - MT-15
  - MT-11
  - MT-16
created_at: 2026-10-01T20:08:48.746Z
updated_at: 2026-10-01T20:41:15.460Z
---

<description>
Repositório de sessões (criar, resolver por token, revogar), helpers de cookie e um preHandler `requireAuth` que popula `request.auth = { userId, accountId, sessionId }` ou responde 401 `UNAUTHENTICATED`.
</description>

<context>
- Contrato §4: cookie `bank_session`, opaco, `HttpOnly`, `SameSite=Lax`, `Path=/`, validade 24 h; `Secure` em HTTPS, desativado só no HTTP local (`COOKIE_SECURE`). APIs privadas → 401 para sessão ausente, expirada ou revogada.
- PRD §6: sessão guarda hash do token, usuário, expiração, revogação.
- PRD §7: nunca logar cookie.
- Usa `generateSessionToken`/`hashSessionToken` (task de hash) e `@fastify/cookie`.
- `createSession` precisa funcionar dentro de uma transação externa (signup cria user+conta+sessão atomicamente).
- Arquivos: `src/modules/auth/session-repository.ts`, `src/http/plugins/auth.ts`, `src/modules/auth/cookie.ts`.
</context>

<plan>
Executado conforme plano. requireAuth extrai authenticate implícito via resolveSession puro (testado); preHandler não testado via HTTP por política.
</plan>

<acceptance>
- [x] Banco guarda apenas o hash do token (nenhuma coluna com token em claro)
- [x] Sessão expirada (now ≥ expires_at) e sessão revogada resolvem `null`
- [x] `revokeSession` com token inexistente não lança
- [x] Cookie emitido com `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=86400` e `Secure` conforme config
- [x] Rotas privadas sem cookie/cookie inválido retornam 401 `UNAUTHENTICATED`
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/auth/session-repository.test.ts` (SQLite temporário em arquivo + seed, clock fake):
- create → resolve retorna userId/accountId corretos
- resolve com now = expiresAt e now > expiresAt → null
- revoke → resolve null; revoke 2× sem erro
- token aleatório não cadastrado → null
- linha gravada não contém o token em claro
Não testar o preHandler via HTTP (política doc-1 §8); se quiser, extrair `authenticate(db, token, now)` puro e testar.
</tests>

<summary>
Sessões com hash sha256, TTL 24h, resolve com JOIN accounts, revoke idempotente, cookie HttpOnly/Lax/Path/MaxAge, requireAuth preHandler. 4 testes, typecheck ok.
</summary>
