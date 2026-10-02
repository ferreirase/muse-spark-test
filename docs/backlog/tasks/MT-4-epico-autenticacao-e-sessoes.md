---
id: MT-4
title: "[Épico] Autenticação e sessões"
status: Done
priority: high
labels:
  - epic
  - auth
  - security
  - cqrs
dependencies: []
created_at: 2026-10-01T20:05:21.086Z
updated_at: 2026-10-01T23:46:59.140Z
---

<description>
Signup, signin e signout com hash scrypt + salt, sessões persistidas no SQLite (token aleatório guardado como hash), cookie `bank_session` e plugin de autenticação que protege as rotas privadas. Requisitos B01 e B02.
</description>

<context>
- Contrato §2 (regras de nome/e-mail/senha), §4 (cookie e 401), §6 (rotas /v1/auth e /v1/me)
- PRD §3 B01/B02, §4 (comandos Signup/Signin/Signout, query GetMe), §7
</context>

<acceptance>
- [ ] Todas as subtasks deste épico fechadas
- [ ] Usuário cadastrado sobrevive a reinício (dados no arquivo SQLite)
</acceptance>

<summary>
Épico concluído: hash scrypt/token (MT-11), sessões+cookie+requireAuth (MT-18) e comandos/rotas de auth (MT-20).
</summary>
