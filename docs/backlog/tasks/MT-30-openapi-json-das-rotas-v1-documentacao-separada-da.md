---
id: MT-30
title: openapi.json das rotas /v1 + documentação separada da API de teste
status: Done
priority: medium
labels:
  - docs
  - openapi
parent: MT-8
dependencies:
  - MT-16
  - MT-20
  - MT-21
  - MT-24
  - MT-26
  - MT-29
created_at: 2026-10-01T20:11:56.517Z
updated_at: 2026-10-02T01:03:41.900Z
---

<description>
Escrever `openapi.json` (OpenAPI 3.1) coerente com todas as rotas normais, DTOs, respostas de erro, header Idempotency-Key e cookie `bank_session`, reaproveitando os JSON Schemas do código. Documentar as rotas `/__test/*` separadamente (fora do openapi principal).
</description>

<context>
- PRD §9: `openapi.json` ou YAML coerente com todas as rotas normais, DTOs, respostas e cookie; API de teste documentada separadamente.
- Rotas normais: contrato §6 (11 rotas /v1) + `GET /health`.
- API de teste: contrato §8 (`/__test/reset`, `/__test/faults`, `/__test/release`, header `X-Test-Control-Token`).
- Sem nova dependência: gerar com script `tsx scripts/build-openapi.ts` que importa os schemas de `src/shared/schemas.ts` e escreve o arquivo (ou escrever à mão reutilizando). Evitar `@fastify/swagger` se o script resolver.
</context>

<plan>
1. `components.schemas` com User, Account, AuthResult, Balance, Recipient, Contact, Transfer, TransferPage, ApiError, bodies de request.
2. `components.securitySchemes.bankSession`: `{type:'apiKey', in:'cookie', name:'bank_session'}`; aplicar nas rotas privadas.
3. Cada rota com todos os status do contrato (201/200/202/204, 400, 401, 403 origin, 404, 409, 422, 500) e exemplos; `Set-Cookie` documentado em signup/signin/signout; header `Idempotency-Key` com pattern; 200 de replay vs 202 de novo pedido.
4. `docs/test-controls.md` com as 3 rotas, flag, token, 404/403, exemplos `curl` e roteiro do cenário PAUSE_AFTER_DEBIT → kill → restart.
5. Validar o JSON: parse + teste unitário que garante que cada rota registrada em `/v1` aparece no openapi (função pura que compara lista de rotas exportada com `paths`).
</plan>

<acceptance>
- [x] `openapi.json` na raiz, OpenAPI 3.1 válido (JSON parseável, campos obrigatórios)
- [x] As 11 rotas /v1 + /health documentadas com todos os códigos de erro do contrato
- [x] Cookie `bank_session` e `Idempotency-Key` documentados
- [x] DTOs idênticos aos do contrato (mesmos nomes/tipos/enums)
- [x] `/__test/*` ausentes do openapi principal e documentadas em `docs/test-controls.md`
- [x] Teste unitário de cobertura de rotas passa
</acceptance>

<tests>
`openapi.test.ts` (puro): carregar `openapi.json`, comparar `paths`+métodos com a lista de rotas exportada pelos módulos; garantir que nenhum path começa com `/__test`.
</tests>

<summary>
`openapi.json` na raiz, OpenAPI 3.1, com as 11 rotas `/v1` + `/health`, todos os status do contrato, `Set-Cookie` em signup/signin/signout, header `Idempotency-Key`, securityScheme `cookieAuth` (bank_session), schemas User/Account/AuthResult/Balance/Recipient/Contact/Transfer/TransferPage/ApiError. `/__test/*` fora do spec, documentadas em `docs/test-controls.md` com flag/token, exemplos e roteiro PAUSE→kill→restart. Teste `tests/unit/openapi.test.ts` cobre rotas, ausência de /__test e cookie/header.
</summary>
