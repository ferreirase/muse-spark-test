---
id: MT-20
title: Comandos Signup, Signin e Signout + rotas /v1/auth
status: Done
priority: high
labels:
  - auth
  - cqrs
  - security
  - unit-tests
parent: MT-4
dependencies:
  - MT-14
  - MT-18
created_at: 2026-10-01T20:09:52.038Z
updated_at: 2026-10-02T01:03:32.181Z
---

<description>
Command handlers de autenticação (lado de escrita do CQRS) e suas rotas Fastify finas. Signup cria user + conta zerada + sessão em uma transação; signin verifica hash e cria sessão; signout revoga e expira cookie, sempre 204.
</description>

<context>
- Contrato §6:
  - `POST /v1/auth/signup` `{name,email,password}` → 201 `AuthResult` + cookie | 409 `EMAIL_ALREADY_EXISTS`
  - `POST /v1/auth/signin` `{email,password}` → 200 `AuthResult` + cookie | 401 `INVALID_CREDENTIALS`
  - `POST /v1/auth/signout` sem corpo → 204 + expira cookie (idempotente, 204 mesmo sem sessão válida)
- Contrato §4: respostas nunca incluem senha, hash ou token.
- PRD B01: e-mail único normalizado; user, conta saldo zero e sessão criados atomicamente.
- PRD §4: rota valida transporte e encaminha; regra fica no handler em `src/modules/auth/commands/`.
- `AuthResult = { user: {id,name,email,createdAt}, account: {id, currency:'BRL', balanceCents} }`.
- Signout pode chegar com `Content-Type: application/json` e corpo vazio (proxy do frontend): não pode virar 400.
</context>

<plan>
1. `signup(deps, input)`: normalizar via `normalizeName`/`normalizeEmail`/`checkPassword`; `hashPassword` antes da tx; tx immediate: insert user (uuid), insert account (uuid, saldo 0), `createSession`; `SQLITE_CONSTRAINT_UNIQUE` em `users.email` → `AppError(409,'EMAIL_ALREADY_EXISTS')`. Retorna `{ authResult, session }`.
2. `signin(deps, input)`: normalizar e-mail; buscar user+account; se não existe, `verifyPassword(pw, DUMMY_PASSWORD_HASH)` e lançar 401 `INVALID_CREDENTIALS`; senha errada → mesmo erro e mesma mensagem; ok → `createSession`.
3. `signout(deps, token?)`: se token presente, `revokeSession`; nunca lança.
4. Rotas em `src/modules/auth/routes.ts` com body/response schemas; setam/limpam cookie; signout: registrar content-type parser tolerante a corpo vazio **só** nessa rota ou usar `onRequest` que zera o body; nenhuma validação de corpo.
5. Log de signup/signin com `userId`, nunca e-mail+senha.
</plan>

<acceptance>
- [x] Signup retorna 201 com `AuthResult` (saldo 0) e cookie; usuário, conta e sessão existem no banco
- [x] Signup com e-mail já existente em outra caixa/espaços (`  ALICE@demo.local `) retorna 409 `EMAIL_ALREADY_EXISTS` e não cria nada
- [x] Falha no meio do signup (ex.: erro ao criar sessão) não deixa usuário órfão (atomicidade)
- [x] Signin com e-mail inexistente e com senha errada retornam o mesmo 401 `INVALID_CREDENTIALS`
- [x] Signout retorna 204 com cookie expirado com ou sem sessão, com ou sem `Content-Type: application/json`
- [x] Sessão revogada não autentica mais
- [x] Nenhuma resposta contém `password`, hash ou token
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/auth/commands/*.test.ts` chamando os handlers direto (SQLite temporário em arquivo + seed, clock fake):
- signup feliz: linhas criadas, saldo 0, e-mail normalizado, senha armazenada como hash scrypt
- signup duplicado (case/trim) → 409, contagem de users inalterada
- atomicidade: stub de `createSession` que lança → nenhum user/account criado
- validações: nome 1 char, senha 7 e 73 chars → VALIDATION_ERROR
- signin ok com `alice@demo.local`/`Demo123!`; e-mail com maiúsculas funciona; senha errada e e-mail inexistente → 401 idênticos
- signout com token válido revoga; sem token / token desconhecido não lança
</tests>

<summary>
`auth/commands/signup.ts` (normaliza, hasheia antes da tx, cria user+conta saldo 0+sessão atomicamente; e-mail duplicado → 409), `signin.ts` (verifica hash; e-mail inexistente usa `DUMMY_PASSWORD_HASH` e retorna o mesmo 401 INVALID_CREDENTIALS), `signout.ts` idempotente, rotas `/v1/auth/*` com schemas, cookie e `Cache-Control: no-store`. Testes em `tests/unit/auth-commands.test.ts`. Nota: signout idempotente; corpo vazio com JSON não bloqueia (sem schema de body).
</summary>
