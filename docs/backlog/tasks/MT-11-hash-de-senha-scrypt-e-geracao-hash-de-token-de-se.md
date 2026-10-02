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
updated_at: 2026-10-02T01:03:23.087Z
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
1. `hashPassword(pw)`: salt `randomBytes(16)`, `scrypt` promisificado com N=2^14, r=8, p=1, keylen=64; serializar como `scrypt$16384$8$1$<saltB64>$<hashB64>`.
2. `verifyPassword(pw, stored)`: parsear formato, recalcular com os parâmetros gravados, comparar com `timingSafeEqual`; formato inválido retorna `false` (nunca lança para o chamador).
3. Exportar `DUMMY_PASSWORD_HASH` (hash fixo calculado no load) para o signin comparar quando o e-mail não existir, igualando tempo de resposta.
4. `generateSessionToken()`: `randomBytes(32).toString('base64url')`.
5. `hashSessionToken(token)`: `createHash('sha256').update(token).digest('hex')` (aceitável porque o token tem 256 bits de entropia; documentar em comentário).
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
`password.ts`: scrypt N=16384,r=8,p=1,keylen=64, salt de 16 bytes, formato `scrypt$N$r$p$salt$hash`, `timingSafeEqual`, formato inválido retorna false; `DUMMY_PASSWORD_HASH` para equalizar o tempo de resposta no signin de e-mail inexistente. `session-token.ts`: token base64url de 32 bytes (43 chars), hash SHA-256 determinístico, comparação constante. Testes em `tests/unit/password.test.ts`.
</summary>
