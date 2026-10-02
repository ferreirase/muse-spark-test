# API de controles de teste — `/__test`

Ferramentas de avaliação determinística da Saga. **Não são funcionalidades de usuário** e não aparecem na API do frontend.

## Habilitação

Desligadas por padrão. Para habilitar, exporte:

```bash
ENABLE_TEST_CONTROLS=true
TEST_CONTROL_TOKEN=<token-secreto-de-teste>
```

Regras de acesso (conforme o contrato §8):

- Flag desligada → todas as rotas `/__test/*` respondem `404`.
- Flag ligada e header `X-Test-Control-Token` ausente ou diferente do configurado → `403 FORBIDDEN`.

## Rotas

### `POST /__test/reset`

Restaura o seed (3 usuários demo) e limpa sessões, contatos adicionais, transferências, jobs, ledger e faults. Para o worker antes de resetar e o reinicia depois. Responde `204`.

### `POST /__test/faults`

```json
{ "sourceAccountId": "acc-alice", "idempotencyKey": "alice-bruno-001", "mode": "FAIL_CREDIT_ONCE" }
```

- `mode`: `FAIL_CREDIT_ONCE` ou `PAUSE_AFTER_DEBIT`.
- O controle é associado a `(sourceAccountId, idempotencyKey)` e consumido **uma vez**.
- Persiste o consumo **antes** de pausar/falhar, então é seguro matar o processo.
- Resposta `201 {"armed": true}`.

### `POST /__test/release`

```json
{ "transferId": "<id>" }
```

Libera a pausa de um worker em execução (`PAUSE_AFTER_DEBIT`) e devolve `204`. Após reinício do processo, uma pausa já consumida **não bloqueia** a recuperação: a Saga apenas retoma do estado `DEBITED` e conclui o crédito.

## Cenários

### `FAIL_CREDIT_ONCE`

Falha definitiva antes do commit do crédito. A Saga marca `COMPENSATING`, executa o reembolso em novo commit e termina em `FAILED` / `CREDIT_FAILED`. Efeitos esperados: um `DEBIT`, nenhum `CREDIT`, um `COMPENSATION`, saldo do remetente restaurado.

### `PAUSE_AFTER_DEBIT`

Bloqueia depois do commit do débito e antes de qualquer crédito. O avaliador observa `status=PROCESSING` e o saldo debitado, pode matar o processo e reiniciar com o mesmo arquivo SQLite; a Saga é retomada pelo estado persistido. Não use sleeps para substituir essa pausa determinística.
