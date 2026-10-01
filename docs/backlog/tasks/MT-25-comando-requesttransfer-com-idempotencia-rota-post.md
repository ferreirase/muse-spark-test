---
id: MT-25
title: Comando RequestTransfer com idempotência + rota POST /v1/transfers
status: Done
priority: high
labels:
  - transfers
  - saga
  - cqrs
  - idempotency
  - unit-tests
parent: MT-6
dependencies:
  - MT-14
  - MT-15
  - MT-18
  - MT-22
created_at: 2026-10-01T20:10:27.500Z
updated_at: 2026-10-01T21:06:09.110Z
---

<description>
Aceitar uma transferência: validar, normalizar, aplicar idempotência por (conta remetente, chave) e persistir transferência CREATED + job durável na **mesma** transação antes de responder 202 PENDING. Replays retornam 200 com a mesma operação. Requisitos B05 e B07.
</description>

<context>
- Contrato §6: `POST /v1/transfers` `{recipientAccountId, amountCents, note?}` + header `Idempotency-Key` → 202 `Transfer` (PENDING) | 404 `RECIPIENT_NOT_FOUND` | 422 `SELF_TRANSFER` | 409 `IDEMPOTENCY_CONFLICT`.
- Contrato §6 Idempotência: chave `^[A-Za-z0-9._:-]{8,128}$`, obrigatória, escopo por conta remetente, sem expiração. Mesma chave + mesmo payload normalizado → **200**, mesmo ID e estado atual, sem novo efeito. Mesma chave + payload diferente → 409. Chaves de usuários diferentes são independentes.
- Contrato §2: remetente vem da sessão; `currency` não é recebido; nota normalizada (vazia → null); saldo insuficiente **não** é erro HTTP (a Saga termina FAILED).
- PRD B07: replays simultâneos também reutilizam a operação.
- PRD §5 regra 1: criar solicitação e trabalho pendente em uma transação local antes de responder.
- Fingerprint: SHA-256 do JSON canônico `{"amountCents":..,"note":..,"recipientAccountId":..}` (chaves em ordem fixa, nota já normalizada).
- Após commit, notificar o worker in-process (`worker.wake()`) para cumprir os 5 s; se o worker não existir ainda, aceitar callback opcional.
- Arquivos: `src/modules/transfers/commands/request-transfer.ts`, `src/modules/transfers/fingerprint.ts`, `src/modules/transfers/routes.ts`.
</context>

<plan>
Executado conforme plano. Rotas verificadas via curl: 202/200/409/400/422. Worker ainda não processa (MT-27) — status fica PENDING até lá, como esperado.
</plan>

<acceptance>
- [x] Novo pedido válido → 202 com `status: PENDING`, `failureCode: null`, `currency: 'BRL'` e job PENDING no banco (mesma tx)
- [x] Replay mesma chave + mesmo payload (inclusive nota `" x "` vs `"x"`) → 200 com o mesmo `id` e estado atual, sem nova linha em transfers/jobs
- [x] Mesma chave + `amountCents` ou destinatário ou nota diferente → 409 `IDEMPOTENCY_CONFLICT`
- [x] Mesma chave usada por Alice e Bruno cria duas transferências independentes
- [x] Chave ausente/inválida → 400 `VALIDATION_ERROR` com field `idempotency-key`
- [x] Self → 422 `SELF_TRANSFER`; destinatário inexistente → 404 `RECIPIENT_NOT_FOUND`
- [x] Corpo com `sourceAccountId`/`currency` extra → 400
- [x] Violação de unicidade concorrente é convertida em replay/conflito, nunca 500
- [x] Testes unitários passam
</acceptance>

<tests>
`fingerprint.test.ts` (pura): ordem de chaves irrelevante na entrada, nota null vs ausente iguais, valores diferentes → hashes diferentes.
`request-transfer.test.ts` (SQLite temporário + seed):
- feliz: transfer + job criados, retorno PENDING
- replay idêntico → replay true, mesmo id, contagens inalteradas
- replay após a transferência virar COMPLETED (UPDATE manual) → retorna estado atual
- conflito por cada campo
- escopo por conta
- corrida simulada: inserir manualmente a linha com a mesma chave entre o SELECT e o INSERT (stub do repo) → replay/conflito correto
- self, inexistente
- `Promise.all` de 10 chamadas com a mesma chave → 1 transferência, todas com o mesmo id
</tests>

<summary>
fingerprint SHA-256 + requestTransfer idempotente (replay/conflito/corrida) + rota POST com 202/200. 9 testes, 106 totais, curl verificado.
</summary>
