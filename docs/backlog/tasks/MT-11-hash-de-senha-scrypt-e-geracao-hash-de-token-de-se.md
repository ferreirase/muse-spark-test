---
id: MT-11
title: Hash de senha (scrypt) e geração/hash de token de sessão
status: Done
priority: high
labels:
  - auth
  - security
  - unit-tests
parent: MT-4
dependencies:
  - MT-9
created_at: 2026-10-01T20:06:34.969Z
updated_at: 2026-10-01T20:28:32.249Z
---

<description>
Funções de segurança puras usadas por signup, signin, sessões e seed: `hashPassword`, `verifyPassword`, `generateSessionToken` e `hashSessionToken`. Tudo com `node:crypto`, sem dependência extra.
</description>

<context>
- PRD §7: hash com algoritmo adequado (scrypt/argon2id/bcrypt) e salt; nunca plaintext ou SHA puro para senha; sessões com aleatoriedade criptográfica.
- PRD §6: token de sessão armazenado como hash.
- Contrato §2: senha 8–72 caracteres, sem trim silencioso (a função recebe a senha exatamente como veio).
- Arquivos: `src/modules/auth/password.ts`, `src/modules/auth/session-token.ts`.
</context>

<plan>
Executado conforme plano. Desvio: promisify(scrypt) não aceita options no tipo do @types/node — trocado por wrapper Promise manual com a overload de 5 args.
</plan>

<acceptance>
- [x] Hash de senha contém salt aleatório: duas chamadas com mesma senha geram strings diferentes
- [x] `verifyPassword` retorna true só para a senha exata (sem trim, case-sensitive)
- [x] Comparação usa `timingSafeEqual`
- [x] Hash corrompido/formato desconhecido retorna false sem exceção
- [x] Token de sessão tem 43 chars base64url e hash sha256 hex determinístico
- [x] Testes unitários passam
</acceptance>

<tests>
`src/modules/auth/password.test.ts` e `session-token.test.ts`:
- hash → verify ok; senha errada; senha com espaço extra no fim falha; hashes distintos para mesma senha
- string `plaintext`, formato com campos faltando, base64 inválido → false
- `DUMMY_PASSWORD_HASH` verifica false para qualquer senha comum
- token: tamanho, charset base64url, 1000 tokens sem colisão; hashSessionToken determinístico e ≠ token
</tests>

<risks>
- scrypt com N alto deixa testes lentos; manter N=2^14 (≈50 ms) ou permitir parâmetro de custo só em teste via argumento opcional.
</risks>

<summary>
scrypt N=2^14 + salt 16B, verify com timingSafeEqual e false em formato inválido, DUMMY hash, token base64url 43 chars + sha256. 7 testes passando, typecheck ok.
</summary>
