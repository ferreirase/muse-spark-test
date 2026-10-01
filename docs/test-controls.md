# API de teste (`/__test/*`) — Banco Demo v1

Rotas de avaliação **separadas da API normal** (não estão no `openapi.json`).
Ferramentas de teste determinísticas da Saga; não fazem parte da jornada do
usuário nem do frontend.

## Ativação

Disponíveis **apenas** quando, no ambiente:

```
ENABLE_TEST_CONTROLS=true
TEST_CONTROL_TOKEN=<token com pelo menos 16 caracteres>
```

- Flag desligada → rotas retornam **404** (nem registradas).
- Sem header `X-Test-Control-Token` ou token inválido → **403**.

Todas exigem o header:

```http
X-Test-Control-Token: <o mesmo valor de TEST_CONTROL_TOKEN>
```

## Rotas

### POST /__test/reset → 204

Restaura a fotografia inicial do seed (Alice 100000, Bruno 25000, Carla 0,
contato `contact-bruno`, sem transferências) e limpa sessões, contatos
adicionais, transferências, progresso de Saga, jobs e ledger.

O worker é pausado, sagas em execução/pausada são abortadas, o reset espera o
worker ficar ocioso (com teto) e então o worker é retomado.

```bash
curl -i -X POST http://127.0.0.1:3001/__test/reset \
  -H "X-Test-Control-Token: $TEST_CONTROL_TOKEN"
```

### POST /__test/faults → 201 `{"armed":true}`

Arma uma injeção determinística vinculada a **uma única transferência**
(identificada pelo par conta remetente + chave de idempotência) e consumida
**uma vez**. Rearmar a mesma chave reseta o consumo.

Body:

```json
{ "sourceAccountId": "acc-alice", "idempotencyKey": "alice-bruno-001", "mode": "PAUSE_AFTER_DEBIT" }
```

Modes:

- `FAIL_CREDIT_ONCE` — falha definitiva **antes do commit do crédito**:
  a Saga compensa (reembolso + ledger COMPENSATION) e termina
  `FAILED` com `failureCode=CREDIT_FAILED`.
- `PAUSE_AFTER_DEBIT` — bloqueia **depois do commit do débito** e antes de
  qualquer crédito. Sem sleeps: o worker espera um `release` explícito
  (ou o fim do processo).

```bash
curl -i -X POST http://127.0.0.1:3001/__test/faults \
  -H "X-Test-Control-Token: $TEST_CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceAccountId":"acc-alice","idempotencyKey":"alice-bruno-001","mode":"PAUSE_AFTER_DEBIT"}'
```

### POST /__test/release → 204

Libera a pausa do worker em execução para a transferência indicada.

```bash
curl -i -X POST http://127.0.0.1:3001/__test/release \
  -H "X-Test-Control-Token: $TEST_CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"transferId":"<id da transferência>"}'
```

## Roteiro do cenário de recuperação (PAUSE_AFTER_DEBIT → kill → restart)

1. Arme a fault (`mode=PAUSE_AFTER_DEBIT`) para `(acc-alice, alice-bruno-001)`.
2. Faça `POST /v1/transfers` com `Idempotency-Key: alice-bruno-001`
   (ex.: 10000 centavos para `acc-bruno`). Retorno 202 PENDING.
3. Consulte `GET /v1/transfers/{id}` → `PROCESSING`; o ledger tem o `DEBIT`
   e o saldo de Alice já reflete o débito; `in_transit` = valor.
4. **Mate o processo** (Ctrl+C ou SIGKILL). A pausa já foi consumida e
   persistida — o reinício não depende de memória.
5. Reinicie o servidor com o mesmo `DATABASE_PATH`. No boot o worker libera
   locks antigos e retoma a Saga pelo estado persistido (`DEBITED`): como a
   fault está consumida, não há nova pausa, e o crédito completa a operação
   em até 10 s sem duplicar efeitos (constraints de unicidade por passo).
6. `GET /v1/transfers/{id}` → `COMPLETED`, com exatamente um DEBIT e um
   CREDIT no ledger.
