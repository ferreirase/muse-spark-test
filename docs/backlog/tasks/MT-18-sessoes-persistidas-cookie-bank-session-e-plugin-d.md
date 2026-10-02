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
updated_at: 2026-10-01T23:07:11.563Z
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
1. `SESSION_TTL_MS = 24*60*60*1000` constante.
2. `createSession(db, userId, now): { token, expiresAt }` — gera token, grava `id`, `token_hash`, `user_id`, `created_at`, `expires_at`; retorna token em claro só para setar cookie. Síncrona (cabe em transação do better-sqlite3).
3. `resolveSession(db, token, now)`: busca por `token_hash` com `revoked_at IS NULL AND expires_at > now`, faz JOIN com `accounts` para retornar `{ sessionId, userId, accountId }` ou `null`.
4. `revokeSession(db, token, now)`: `UPDATE ... SET revoked_at = now WHERE token_hash = ? AND revoked_at IS NULL`; sem erro se não existir (signout idempotente).
5. `setSessionCookie(reply, token, expiresAt, secure)` com `maxAge` 86400 e `expires`; `clearSessionCookie(reply, secure)` com mesmos atributos e `maxAge: 0`.
6. `requireAuth` preHandler: lê `request.cookies.bank_session`, `resolveSession`, senão lança `AppError(401,'UNAUTHENTICATED')`. Declarar tipo `request.auth` via module augmentation.
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
session-repository.ts: SESSION_TTL_MS 24h, createSession síncrona (cabe na transação do signup), resolveSession com JOIN accounts (revogada/expirada → null), revokeSession idempotente, authenticate puro. cookie.ts: setSessionCookie/clearSessionCookie HttpOnly SameSite=Lax Path=/ maxAge 86400/0 Secure por config. http/plugins/auth.ts: decorateRequest auth + requireAuth preHandler → 401 UNAUTHENTICATED. Testes 7 (incl. fronteira de expiração, hash-only no banco, signout idempotente). Commits ba5a21e+f910bd6.
</summary>
