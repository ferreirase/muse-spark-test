# API de teste (`/__test/*`) — fora do OpenAPI

Ferramentas de avaliação determinística da Saga. **Não fazem parte da API do frontend.**
Só existem com `ENABLE_TEST_CONTROLS=true` **e** `TEST_CONTROL_TOKEN` (≥16 chars).
Toda chamada exige o header `X-Test-Control-Token: <token>`.

| Situação | Resposta |
|---|---|
| Flag desligada | `404` (rotas nem registradas) |
| Token ausente/errado | `403` `TEST_CONTROLS_FORBIDDEN` |

## POST /__test/reset → 204

Restaura o seed (3 usuários, 3 contas, 1 contato, soma 125000) e limpa sessões,
contatos extras, transferências, ledger, jobs e faults. Pausa o worker, aborta
pausas pendentes, aguarda ociosidade, reseta e retoma.

```bash
curl -X POST http://127.0.0.1:3001/__test/reset \
  -H "X-Test-Control-Token: $TOKEN"
```

## POST /__test/faults → 201 `{armed:true}`

Arma uma fault para UMA transferência identificada por `(sourceAccountId, idempotencyKey)`.
Rearmar reseta o consumo. Body (sem extras):

```json
{ "sourceAccountId": "acc-alice", "idempotencyKey": "alice-bruno-001", "mode": "FAIL_CREDIT_ONCE" }
```

| mode | Efeito |
|---|---|
| `FAIL_CREDIT_ONCE` | Falha definitiva antes do commit do crédito → compensação → `FAILED`/`CREDIT_FAILED` |
| `PAUSE_AFTER_DEBIT` | Bloqueia após o commit do débito, antes de qualquer crédito. Consumo persistido antes de pausar; redelivery não pausa de novo |

```bash
curl -X POST http://127.0.0.1:3001/__test/faults \
  -H 'Content-Type: application/json' -H "X-Test-Control-Token: $TOKEN" \
  -d '{"sourceAccountId":"acc-alice","idempotencyKey":"alice-bruno-001","mode":"PAUSE_AFTER_DEBIT"}'
```

## POST /__test/release → 204

Libera a pausa em execução. Body: `{ "transferId": "<id>" }`. Sem pausa para o id → no-op (ainda 204).

```bash
curl -X POST http://127.0.0.1:3001/__test/release \
  -H 'Content-Type: application/json' -H "X-Test-Control-Token: $TOKEN" \
  -d '{"transferId":"<id-da-transferencia>"}'
```

## Roteiro: kill no meio da pausa → restart

1. `POST /__test/reset` (token) — ponto de partida limpo.
2. `POST /__test/faults` com `PAUSE_AFTER_DEBIT` para `(acc-alice, <chave>)`.
3. Signin como Alice; `POST /v1/transfers` com a mesma chave → `202 PENDING`.
4. Aguardar `PROCESSING` em `GET /v1/transfers/<id>`; conferir `ledger` (1 DEBIT) e `in_transit = amount`.
5. **Matar o processo** (`kill`) e reiniciar com o **mesmo** `DATABASE_PATH`.
6. O worker retoma no boot: a pausa já foi consumida, então a saga **completa sem release** → `COMPLETED`.
