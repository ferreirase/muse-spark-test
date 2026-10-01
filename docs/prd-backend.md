# PRD Backend — Banco Demo v1

Versão 1.1 · 01/10/2026 · Status: especificação pronta para implementação · 1.1: política de testes só unitários (§8, §9)

## 1. Instrução ao modelo executor

Implemente e entregue o backend descrito neste PRD e no arquivo obrigatório `contrato-compartilhado.md`. A entrega é código executável, persistência e evidências de teste. Documente escolhas e limitações. Não substitua requisitos por um plano, pseudocódigo ou pastas com nomes de padrões.

O contrato compartilhado é a autoridade para endpoints, DTOs, autenticação, seed, erros e modos de avaliação. Este PRD define arquitetura, persistência e critérios específicos do backend. Não implemente frontend.

## 2. Objetivo e escopo

Permitir signup, signin, signout, consulta de saldo, contatos salvos e transferências simuladas entre contas locais. Demonstrar CQRS e Saga funcionando em casos de sucesso, falha, concorrência e recuperação de processo.

Obrigatórios: Node.js + TypeScript + Fastify; arquivo SQLite; CQRS; Saga orquestrada e persistida para transferências. Fixar versões no lockfile e documentar a versão de Node suportada. ORM ou driver SQLite são livres. Usar um monólito modular, um processo de API e worker local recuperável; não exigir infraestrutura externa.

## 3. Requisitos funcionais

| ID | Requisito | Critério de aceite |
|---|---|---|
| B01 | Signup persistido | E-mail único normalizado; user, conta com saldo zero e sessão criados atomicamente; cadastro sobrevive a reinício |
| B02 | Signin e signout | Credenciais verificadas contra hash com salt; sessão persiste no SQLite, expira e é revogada por logout |
| B03 | Saldo | Query retorna o saldo real da conta autenticada, inclusive centavos, sem dados de outra conta |
| B04 | Contatos | Criar e listar por usuário; validar destinatário; rejeitar duplicata e própria conta |
| B05 | Transferir | POST persistido retorna 202 PENDING, worker executa Saga, queries mostram evolução |
| B06 | Acompanhar | Detalhe e histórico paginado permitem identificar resultado e motivo de falha |
| B07 | Idempotência | Replays, inclusive simultâneos, reutilizam a operação; conflito de payload retorna 409 |
| B08 | Concorrência | Dois envios concorrentes não ultrapassam o saldo disponível |
| B09 | Compensação | Falha definitiva de crédito restaura somente o débito da transferência afetada |
| B10 | Recuperação | Reinício após débito retoma a Saga sem duplicar efeitos e termina consistentemente |

## 4. CQRS obrigatório e verificável

Separar explicitamente o caminho de comandos do caminho de consultas:

- Comandos: Signup, Signin/criação de sessão, Signout, AddContact, RequestTransfer e os passos internos da Saga.
- Queries: GetMe, GetBalance, GetRecipient, ListContacts, GetTransfer e ListTransfers.
- Handlers de comando executam validações de domínio e alterações persistidas. Handlers de query retornam DTOs; não criam registros, executam Saga ou corrigem saldos.
- Routes Fastify validam transporte, autenticam e encaminham a execução. SQL, regras de dinheiro e orquestração não ficam concentrados no handler HTTP.
- Ports/repositories ou interfaces equivalentes deixam identificáveis as dependências de leitura e escrita. Podem compartilhar a conexão e as tabelas SQLite.
- O read model pode consultar tabelas/vistas diretamente com mapeamento para DTOs. Não exigir uma cópia assíncrona de todo o banco, event sourcing ou um command bus de biblioteca.

Aceite arquitetural: o avaliador consegue seguir um POST até um command handler e um GET até um query handler distinto, sem que as duas rotas chamem o mesmo serviço CRUD indiferenciado. Explique no README onde estão esses caminhos.

## 5. Saga de transferência

Exigir transações locais com commits separados, progresso persistido e compensação efetiva. Uma única transação SQL cobrindo débito e crédito é insuficiente para cumprir este requisito de avaliação.

### Estados e efeitos

| Etapa interna | Estado público | Commit local obrigatório |
|---|---|---|
| CREATED | PENDING | Transferência, chave/payload de idempotência e trabalho durável são criados juntos |
| DEBITED | PROCESSING | Débito condicionado a fundos, ledger de débito, valor em trânsito e progresso da Saga são persistidos juntos |
| COMPLETED | COMPLETED | Crédito, ledger de crédito, remoção do valor em trânsito e conclusão da Saga são persistidos juntos |
| COMPENSATING | PROCESSING | Falha definitiva de crédito é registrada; trabalho de compensação fica recuperável |
| FAILED antes de débito | FAILED | Motivo INSUFFICIENT_FUNDS; sem efeito financeiro |
| FAILED após compensação | FAILED | Reembolso, ledger de compensação, remoção de trânsito e conclusão são persistidos juntos; motivo CREDIT_FAILED |

O ponto de conclusão é o commit do crédito junto com o estado COMPLETED. Depois desse commit, a Saga não pode compensar o remetente por falha de logging, resposta HTTP ou acknowledgement do worker.

### Regras de execução

1. Validar transporte, sessão, destinatário e chave; normalizar payload. Criar solicitação e trabalho pendente em uma transação local antes de responder.
2. Worker lê trabalho durável e inicia/retoma a Saga. Saldo insuficiente termina sem débito.
3. Debitar com operação SQL condicionada a saldo suficiente, ou mecanismo transacional equivalente sem race entre leitura e escrita. Marcar DEBITED e commit.
4. Creditar destinatário e marcar COMPLETED em outro commit local. Crédito não pode ser aplicado sem débito registrado.
5. Se houver falha definitiva antes do commit do crédito, marcar COMPENSATING e executar reembolso em novo commit.
6. Falhas transitórias de infraestrutura, como SQLITE_BUSY, usam retry limitado por tentativa com backoff; esgotamento mantém trabalho recuperável e PROCESSING. Não abandonar dinheiro nem declarar FAILED sem compensar.
7. Após reinício, identificar trabalhos incompletos e retomar pelo estado persistido. Estado e efeitos financeiros de cada passo devem ser atômicos, inclusive se o processo morrer entre commit e retorno da função.

### Idempotência por passo e invariantes

- Existe no máximo um débito, um crédito e uma compensação por transferência, garantidos também por constraints ou mecanismo durável equivalente.
- Um crédito concluído nunca é acompanhado de compensação do mesmo débito.
- Balance de toda conta é inteiro não negativo.
- Sem depósitos, taxas ou resets, `soma dos saldos + soma dos valores em trânsito = 125000 centavos`. Signups acrescentam zero.
- Em estado terminal não há valor em trânsito para aquela transferência.
- Compensar significa adicionar de volta o valor debitado; nunca restaurar um snapshot antigo de saldo que apagaria outras operações legítimas.
- Reexecutar comandos internos ou redeliver trabalhos não altera um passo já aplicado.
- Uma falha em determinada transferência não corrompe ou bloqueia definitivamente outras.

Worker pode usar outbox/job table SQLite, polling ou mecanismo equivalente. A durable job table criada no mesmo commit da solicitação é suficiente. Não exigir Kafka, Redis, RabbitMQ ou outro banco. Coordenar o worker para não processar a mesma operação simultaneamente, com recuperação de claims/locks após crash.

## 6. Modelo de persistência mínimo

Entidades conceituais obrigatórias; nomes físicos e normalização são livres:

- Users: identidade, e-mail normalizado único, hash de senha e timestamps.
- Accounts: relação única com usuário, BRL, saldo inteiro, timestamp; constraints de integridade.
- Sessions: token armazenado como hash ou identificador seguro equivalente, usuário, expiração e revogação.
- Contacts: dono e destinatário, apelido, unicidade por dono/destinatário.
- Transfers: remetente, destinatário, amount, note, status e failureCode, datas, idempotency key e fingerprint do payload.
- Saga progress: etapa, tentativas, último erro, valor em trânsito e timestamps; pode integrar Transfers.
- Ledger: efeitos DEBIT, CREDIT e COMPENSATION, com transferência, conta, valor assinado e unicidade de passo. Ledger auditável, sem apagar lançamentos para desfazer operações.
- Durable jobs/outbox: o próximo trabalho e seus dados de recuperação.

Seeds iniciais não exigem lançamentos de abertura. O README descreve como reconciliar a soma dos saldos e ledger a partir dos saldos do seed.

SQLite deve ser um arquivo configurável por `DATABASE_PATH`, nunca apenas `:memory:` na execução do app. Habilitar foreign keys em cada conexão; usar constraints de unicidade e dinheiro. Configurar tratamento de lock/busy apropriado. Migrações e seed reproduzíveis. Reinício normal não executa reset.

## 7. Segurança, erros e observabilidade

- Hash de senha com algoritmo adequado, como scrypt, argon2id ou bcrypt, e salt; não plaintext ou SHA puro. Não registrar senha nem cookie.
- Criar sessões com aleatoriedade criptográfica; logout revoga sessão no servidor.
- Validar schemas de request e response no Fastify ou integração equivalente, sem coerção indevida de strings para valores monetários.
- SQL parametrizado; proteção contra acesso a registros de outro usuário e campos não autorizados.
- Logs estruturados com requestId, transferId, etapa e erro quando aplicável. Mensagens ao cliente não vazam SQL, hash ou stack trace.
- Controles de teste exatamente conforme contrato, isolados por flag e token.

## 8. Performance e testabilidade

Em ambiente local saudável, uma transferência normal deve chegar a estado terminal em até 5 segundos depois de aceita. Após reinício ou release de pausa, recuperar em até 10 segundos. Testes esperam por estado com timeout, em vez de depender de uma latência exata de worker.

**Política de testes (decisão do dono do projeto, 01/10/2026 — substitui a versão 1.0 desta seção):** entregar **somente testes unitários** de unidades que executam ações: services, command/query handlers, passos da Saga, orquestrador, worker e funções puras (validação, hash, cursor, fingerprint, retry, mapeamento de erro, Origin).

- O teste chama a função diretamente. Fora de escopo: testes de integração HTTP (`fastify.inject` ou servidor real), e2e, spawn de processo, browser e testes de carga.
- Unidades cujo comportamento é a própria transação SQL (repositórios, handlers, passos da Saga) podem usar SQLite temporário em arquivo, criado pela função de migração e apagado ao fim do teste. Nunca `:memory:`.
- Cenários obrigatórios em nível unitário: sucesso, saldo insuficiente, idempotência/replay concorrente, disputa por saldo, falha de crédito com compensação e recuperação após reinício.
- Recuperação é testada fechando a conexão e abrindo uma nova instância sobre o mesmo arquivo, sem reiniciar o processo do sistema operacional.
- Relógio, sleep e geração de IDs são injetáveis; esperar estado com timeout, nunca sleep fixo.

## 9. Entregáveis e definição de pronto

- Código completo + lockfile + `.env.example`, sem segredos reais.
- Scripts `npm run dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`, `db:seed`, `db:reset`. README informa comando de instalação e versão de Node.
- Arquivo SQLite gerado por migrate/seed, com path configurável. Não depender de um arquivo binário previamente preenchido.
- `openapi.json` ou YAML coerente com todas as rotas normais, DTOs, respostas e cookie; API de teste documentada separadamente.
- README: quickstart, credenciais demo, CQRS, diagrama ou tabela da Saga, persistência, retries, comandos de teste, controles de falha e limitações.
- Relatório curto com comandos realmente executados e seus resultados. Distinguir testes executados de casos apenas previstos e declarar explicitamente que testes de integração, e2e e recuperação com reinício real de processo não foram feitos por decisão de escopo (§8).
- Implementação passa o contrato e pode ser usada pelo frontend sem alterações em DTOs ou rotas.

Não fazem parte da nota: número de arquivos, escolha de ORM, abstrações adicionais, microsserviços, deploy, performance de produção ou recursos bancários fora do escopo.
