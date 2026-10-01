# Contrato compartilhado — Banco Demo v1

Versão: 1.0 · Data: 01/10/2026 · Idioma: pt-BR · Moeda: BRL

Documento normativo para os PRDs de frontend e backend. Entregar este arquivo junto com o PRD correspondente a cada modelo. Os nomes de campos, rotas, estados e códigos de erro abaixo são obrigatórios. Decisões de implementação que não alterem o contrato são livres.

## 1. Produto, premissas e limites

Construir uma primeira camada de app bancário para comparar a capacidade de modelos em entregas reais. O usuário pode cadastrar-se, entrar, consultar saldo, enviar dinheiro a outra conta fictícia e salvar destinatários para futuros envios.

- Todos os usuários, contas e valores são fictícios; todas as operações ocorrem localmente. Não há serviços financeiros externos.
- “Mockado” significa dados de demonstração e serviços simulados. No backend, cadastro, sessões, contatos e transferências devem produzir alterações reais e persistidas em um arquivo SQLite.
- Contato recorrente é um destinatário salvo. Não inclui pagamentos agendados.
- Cada usuário possui exatamente uma conta em BRL. Contatos e transferências referenciam essa conta pelo ID.
- Não há taxas, câmbio, cheque especial, depósito, saque, recuperação de senha, MFA, KYC, cartões ou Pix real.
- Histórico paginado e detalhe de transferência entram no escopo para acompanhar processamento e validar o resultado; não se exige extrato bancário completo.
- Uma instância de backend e um worker local são suficientes. Não se exige cluster, broker externo, microsserviços ou event sourcing.

## 2. Dados e regras comuns

- IDs: strings opacas, estáveis e não vazias. O seed usa os IDs abaixo; novos registros podem usar UUIDs.
- Datas: ISO 8601 UTC, por exemplo `2026-10-01T19:00:00.000Z`.
- Valores: inteiros em centavos. `10001` significa R$ 100,01. Nunca transportar dinheiro como ponto flutuante.
- Transferência: `amountCents` deve ser inteiro entre 1 e 100000000; `currency` não é recebido no POST, pois é sempre BRL.
- Nome: trim, 2–80 caracteres. E-mail: trim + lowercase, formato válido e até 254 caracteres. Senha: 8–72 caracteres, sem trim silencioso.
- Apelido de contato: trim, 1–60 caracteres. Nota da transferência: opcional, trim, até 140 caracteres; ausente ou vazia após trim resulta em `null`.
- Um usuário não pode transferir para si mesmo ou cadastrar a própria conta como contato.
- Uma conta destinatária deve existir. Transferir por ID não exige que ela já esteja salva como contato.
- O remetente vem da sessão autenticada. O cliente nunca escolhe `sourceAccountId` em uma operação normal.
- Saldo nunca pode ficar negativo. A validação definitiva de fundos acontece no débito da Saga.

## 3. Seed reproduzível

Senha de todas as contas de demonstração: `Demo123!`.

| Usuário | E-mail | user.id | account.id | Saldo inicial |
|---|---|---|---|---:|
| Alice Demo | alice@demo.local | user-alice | acc-alice | 100000 |
| Bruno Demo | bruno@demo.local | user-bruno | acc-bruno | 25000 |
| Carla Demo | carla@demo.local | user-carla | acc-carla | 0 |

Alice tem um contato inicial: `contact-bruno`, apelido `Bruno`, destinatário `acc-bruno`. Bruno e Carla começam sem contatos. Não existem transferências iniciais. Novo signup cria conta com saldo zero. O seed não reaplica saldo nem apaga operações ao reiniciar; apenas reset explícito restaura a fotografia inicial.

## 4. Transporte e autenticação

- Backend local: `http://127.0.0.1:3001`; frontend: `http://127.0.0.1:3000`.
- Rotas bancárias: prefixo `/v1`; corpo JSON e `Content-Type: application/json` para POST.
- Sessão por cookie `bank_session`, opaco, HttpOnly, SameSite=Lax, Path=/, validade de 24 horas; Secure em HTTPS e desativado apenas no ambiente HTTP local.
- Signup e signin criam sessão. Respostas não incluem senha, hash ou token de sessão.
- APIs privadas retornam 401 para sessão ausente, expirada ou revogada. Signout é idempotente e retorna 204, mesmo sem sessão válida.
- Frontend chama seu proxy `/api/bank/*`, que encaminha para `/v1/*` no Fastify, inclusive Cookie e Set-Cookie. Assim o fluxo no browser é same-origin. O proxy não implementa regras bancárias.
- `API_BASE_URL` é configuração do servidor Next.js, nunca uma URL hardcoded no componente. Cookie não pode ser lido pelo JavaScript do browser.
- Backend valida Origin quando fornecido: aceitar a origem do frontend configurada; rejeitar outras em mutações. Requisições CLI sem Origin podem ser usadas nos testes. Não usar CORS com origem irrestrita e credenciais.
- Respostas autenticadas e financeiras devem usar `Cache-Control: no-store`.
- `GET /health` é público e retorna `{"status":"ok"}` quando o app e o SQLite estão prontos.

## 5. DTOs

Os DTOs abaixo usam sintaxe TypeScript apenas para definir o contrato, não para impor bibliotecas.

```ts
type User = { id: string; name: string; email: string; createdAt: string };
type Account = { id: string; currency: "BRL"; balanceCents: number };
type AuthResult = { user: User; account: Account };
type Balance = {
  accountId: string; currency: "BRL"; balanceCents: number; updatedAt: string
};
type Recipient = { accountId: string; name: string };
type Contact = {
  id: string; nickname: string; recipientAccountId: string;
  recipientName: string; createdAt: string
};
type Transfer = {
  id: string; sourceAccountId: string; recipientAccountId: string;
  recipientName: string; amountCents: number; currency: "BRL";
  note: string | null;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  failureCode: "INSUFFICIENT_FUNDS" | "CREDIT_FAILED" | null;
  createdAt: string; updatedAt: string;
};
type TransferPage = {
  items: Transfer[]; nextCursor: string | null
};
type ApiError = {
  error: {
    code: string; message: string;
    details?: Array<{ field: string; message: string }>
  };
  requestId: string;
};
```

`balanceCents` é o saldo disponível atual: diminui após débito de uma transferência em processamento e volta se houver compensação. `COMPLETED` implica crédito concluído; `FAILED` implica ausência de débito ou compensação concluída. Durante falha técnica ainda não resolvida, manter `PROCESSING`, nunca declarar falha antes de devolver o débito.

## 6. Endpoints obrigatórios

| Método e rota | Entrada | Sucesso | Falhas específicas |
|---|---|---|---|
| POST /v1/auth/signup | `{name,email,password}` | 201 AuthResult + cookie | 409 EMAIL_ALREADY_EXISTS |
| POST /v1/auth/signin | `{email,password}` | 200 AuthResult + cookie | 401 INVALID_CREDENTIALS |
| POST /v1/auth/signout | sem corpo | 204 + expira cookie | — |
| GET /v1/me | — | 200 AuthResult | 401 UNAUTHENTICATED |
| GET /v1/accounts/me/balance | — | 200 Balance | 401 UNAUTHENTICATED |
| GET /v1/recipients/:accountId | ID exato | 200 Recipient | 404 RECIPIENT_NOT_FOUND; 422 SELF_RECIPIENT |
| GET /v1/contacts | — | 200 `{items: Contact[]}` | 401 UNAUTHENTICATED |
| POST /v1/contacts | `{nickname,recipientAccountId}` | 201 Contact | 404 RECIPIENT_NOT_FOUND; 409 CONTACT_ALREADY_EXISTS; 422 SELF_RECIPIENT |
| POST /v1/transfers | `{recipientAccountId,amountCents,note?}` + Idempotency-Key | 202 Transfer, inicialmente PENDING | 404 RECIPIENT_NOT_FOUND; 422 SELF_TRANSFER; 409 IDEMPOTENCY_CONFLICT |
| GET /v1/transfers/:id | — | 200 Transfer | 404 TRANSFER_NOT_FOUND |
| GET /v1/transfers?limit=20&cursor=... | limit inteiro 1–50; cursor opcional | 200 TransferPage | 400 VALIDATION_ERROR |

Todas as rotas privadas também podem retornar 401. Corpo, parâmetros ou cabeçalhos inválidos retornam 400 `VALIDATION_ERROR`, com `details` para campos corrigíveis. Falha interna retorna 500 `INTERNAL_ERROR`, sem stack trace. Origin proibida retorna 403 `ORIGIN_NOT_ALLOWED`. O servidor rejeita propriedades extras nos corpos de signup, signin, contato e transferência; nunca aceita alteração de saldo ou remetente por mass assignment.

- Consultar destinatário requer sessão e retorna apenas nome e ID, sem e-mail, saldo ou outros dados.
- Contatos pertencem ao usuário autenticado; ordenar por nickname e, em empate, ID. Não há edição ou exclusão nesta versão.
- Histórico e detalhe incluem apenas transferências enviadas pelo usuário autenticado. O destinatário vê o crédito no saldo, mas não o histórico do remetente. IDs de outros usuários retornam 404.
- Histórico: ordem decrescente por createdAt e, em empate, ID; cursor opaco e estável. Cursor inválido retorna 400.
- Saldo insuficiente não é erro HTTP do POST aceito: a Saga termina em FAILED com `failureCode=INSUFFICIENT_FUNDS` e nenhuma movimentação.

### Idempotência

`Idempotency-Key` é obrigatório, string de 8–128 caracteres ASCII restritos a letras, números, ponto, underscore, dois-pontos e hífen (`^[A-Za-z0-9._:-]{8,128}$`). A chave tem escopo por conta remetente e fica persistida sem expirar nesta versão. Novo pedido válido retorna 202 PENDING. Repetição com a mesma chave e payload normalizado retorna 200, o mesmo ID e seu estado atual, sem novo débito, crédito ou Saga. Mesma chave com payload diferente retorna 409 IDEMPOTENCY_CONFLICT. Chaves de usuários diferentes são independentes. O POST deve persistir a operação e o trabalho pendente antes de responder.

Exemplo:

```http
POST /v1/transfers
Content-Type: application/json
Idempotency-Key: alice-bruno-001

{"recipientAccountId":"acc-bruno","amountCents":10000,"note":"Almoço"}
```

O fluxo aceito é POST → PENDING/PROCESSING → consulta do ID → COMPLETED ou FAILED. Fechar a página não cancela a operação.

## 7. Modo mock do frontend

O frontend possui modos `mock` e `api`, com o mesmo contrato HTTP e os mesmos DTOs. Modo mock é padrão para avaliação isolada; modo api utiliza o proxy para Fastify. A simulação deve manter sessões e dados entre requests, permitir signup/signin e transições de transferência; não basta retornar JSON estático.

A persistência normativa em SQLite pertence ao backend. No mock isolado do frontend, estado em memória de um processo é suficiente, com reset reproduzível. Não exigir banco duplicado no Next.js. O frontend precisa sobreviver a reload da página no mesmo processo, consultando sessão e transferências existentes. Reinício do servidor mock pode restaurar o seed.

O mock deve disponibilizar cenários selecionáveis apenas em desenvolvimento/teste: normal; crédito falha; resposta atrasada; sessão expirada; rede indisponível; resposta do POST perdida após aceitação. O README explica como ativar cada um. As opções não aparecem na jornada bancária normal.

## 8. Controles de avaliação do backend

Para testes determinísticos de Saga, o backend oferece as rotas abaixo apenas com `ENABLE_TEST_CONTROLS=true` e um `TEST_CONTROL_TOKEN` explícito, via `X-Test-Control-Token`. Com flag desligada, rotas retornam 404; com token inválido, 403. São ferramentas de teste, não funcionalidades de usuário.

- `POST /__test/reset`: restaura o seed e limpa sessões, contatos adicionais, transferências, Saga, trabalhos e ledger. Aguarda worker ocioso ou pausa-o antes do reset; retorna 204.
- `POST /__test/faults`: `{sourceAccountId,idempotencyKey,mode}`; modes `FAIL_CREDIT_ONCE` e `PAUSE_AFTER_DEBIT`; retorna 201 `{armed:true}`. O controle fica associado a uma única transferência e é consumido uma vez, persistindo o consumo antes de pausar/falhar.
- `POST /__test/release`: `{transferId}`; libera a pausa do worker em execução; retorna 204. Após reinício do processo, uma pausa já consumida não bloqueia recuperação.

FAIL_CREDIT_ONCE provoca falha definitiva antes do commit do crédito; deve gerar compensação e FAILED/CREDIT_FAILED. PAUSE_AFTER_DEBIT bloqueia depois do commit do débito e antes de qualquer crédito: o avaliador consulta estado/ledger, mata o processo e reinicia com o mesmo arquivo. Não usar sleeps como substituto dessa pausa determinística. Os controles não entram na API do frontend.

## 9. Fontes técnicas consultadas

Os requisitos são decisões deste benchmark. As fontes sustentam os conceitos usados, não os valores específicos de seed, rotas ou pontuação.

- CQRS com modelos separados e um banco compartilhado: https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs
- Saga, transações locais e compensações: https://learn.microsoft.com/en-us/azure/architecture/patterns/saga
- Fastify, validação e serialização: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Next.js, Server e Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- SQLite, transações e concorrência de escrita: https://www.sqlite.org/lang_transaction.html
- DeepSWE, tarefas reais e verificação por comportamento: https://deepswe.datacurve.ai/
