# Avaliação independente — Banco Demo v1

Versão 1.0 · 01/10/2026 · Rubrica para comparar entregas de backend e frontend

## 1. Prompt para o modelo avaliador

Você é o avaliador independente das implementações do Banco Demo. Leia `contrato-compartilhado.md`, `prd-backend.md` e `prd-frontend.md` e execute a checklist deste documento. Avalie cada entrega pela evidência observada, sem favorecer fornecedor, estilo ou quantidade de código.

Não altere a implementação para fazê-la passar. Instalar dependências e configurar o ambiente conforme README é permitido. Se for preciso corrigir código, primeiro registre a falha; avalie a versão corrigida como uma nova tentativa. Você pode criar testes externos e fixtures em uma pasta separada, sem fornecer soluções ao executor. Testes ocultos devem verificar requisitos já especificados, nunca inventar requisitos novos.

Leia o código para verificar CQRS e Saga; execute APIs e browser para verificar comportamento. Não aceite autoavaliação do executor como prova. Se não puder executar um caso por limitação do seu ambiente, registre NÃO VERIFICADO e o motivo, sem inventar resultado. Entregue evidências reproduzíveis, notas separadas e veredito sobre os requisitos obrigatórios.

## 2. Preparação e condições justas

- Entregar ao executor de backend: seu PRD + contrato. Ao executor de frontend: seu PRD + contrato. Esta rubrica pode ser entregue também, pois não cobra requisitos secretos.
- Para isolar capacidade, usar a mesma infraestrutura, snapshot inicial, ferramentas, acesso a documentação e orçamento de tempo/custo. Registrar modelo/versão, nível de reasoning, agente/harness e permissões.
- Se usar ferramentas nativas diferentes, rotular a comparação como modelo + ferramenta. Não atribuir toda diferença ao modelo isolado.
- Registrar tempo de implementação, custo/tokens quando disponíveis, intervenções humanas e tentativas. Esses dados são eixos separados da nota funcional; não imputar valores ausentes.
- Executar cada entrega em ambiente isolado; usar arquivo SQLite temporário exclusivo. Não compartilhar sessões ou dados entre modelos.
- Instalar conforme README, copiar env de exemplo, migrar e seedar. Registrar comandos, exit codes, versões e commit/hash do código quando disponível.
- Resetar dados antes de cada cenário que altera saldo, contatos ou sessões. Depois do reset, autenticar novamente.
- Avaliar frontend isoladamente contra mock e, preferencialmente, uma API de referência independente que cumpra o contrato. Depois avaliar o par frontend/backend. Backend defeituoso não reduz automaticamente a nota isolada do frontend.
- Para frontend, usar browser real em 375 px e 1440 px, capturar console/network e screenshots relevantes. Não avaliar só por screenshots.
- Usar timeout de 5 s para operação saudável e 10 s para recuperação. Registrar máquina/latência e investigar se atraso é do ambiente antes de marcar uma falha.
- Um resultado é da implementação avaliada. Para inferir comportamento de um modelo, repetir a geração da entrega com pelo menos três execuções independentes, se viável; não confundir reexecutar testes na mesma entrega com gerar novas entregas.

## 3. Requisitos eliminatórios e pontuação

Cada lado recebe uma nota de 0–100. Cada item usa fator 0 (falha), 0,5 (parcial) ou 1 (passa), multiplicado pelo peso. Use parcial somente quando subcasos identificados passam e outros falham; enumere-os. NÃO VERIFICADO não recebe nota inventada: informar pontos demonstrados, pontos possíveis verificados e cobertura, sem normalizar para 100 nem declarar aprovação completa.

Critérios obrigatórios do backend:

- [ ] Fastify executa a API; TypeScript compila.
- [ ] SQLite em arquivo persiste estado após reinício.
- [ ] CQRS tem caminhos de comando/query distintos e identificáveis.
- [ ] Saga possui commits locais separados, progresso durável, compensação e recuperação demonstrados.
- [ ] Autenticação e isolamento por usuário funcionam.
- [ ] Não há saldo negativo, débito/crédito duplicado ou criação/destruição de dinheiro nos casos de teste.

Critérios obrigatórios do frontend:

- [ ] Next.js com App Router e TypeScript; build executável.
- [ ] Signup/signin, saldo, contato salvo e envio são jornadas funcionais.
- [ ] Estados PENDING/PROCESSING não são apresentados como sucesso.
- [ ] Retry de resultado desconhecido conserva chave e payload; não duplica transferência.
- [ ] Modos mock e api existem e respeitam o contrato.

Falhar um eliminatório significa REPROVADO NOS REQUISITOS OBRIGATÓRIOS, mesmo com nota alta. Mantenha a nota bruta para comparação; não esconda o problema atrás de um desconto arbitrário. Com todos os eliminatórios demonstrados e nota >= 80, classificar APROVADO NESTE BENCHMARK; abaixo de 80, REQUER AJUSTES. O limiar é uma escolha deste protocolo, não um padrão do setor.

## 4. Backend — checklist e pesos

| ID | Peso | Verificação e resultado esperado |
|---|---:|---|
| BE01 | 5 | Instalação, build, typecheck, migração/seed/reset e persistência: seed é reproduzível; reinício não reverte dados |
| BE02 | 10 | Signup/signin/signout: normalização, e-mail duplicado, senha inválida, hash com salt, sessão persistida/expirada/revogada |
| BE03 | 10 | Autorização: rotas privadas 401; detalhe alheio 404; contato e saldo isolados; campos extras rejeitados; cookie/Origin corretos |
| BE04 | 5 | Contatos: criar, listar, persistir, rejeitar próprio/duplicado/inexistente e impedir visibilidade cruzada |
| BE05 | 5 | Queries/contrato: DTOs, lookup mínimo, histórico estável e paginação sem duplicatas ou lacunas |
| BE06 | 10 | Transferência normal: 202 PENDING, terminal COMPLETED, centavos exatos, saldo e ledger correspondentes |
| BE07 | 5 | Validação/fundos: zero, negativo, decimal, string, limite, destino inválido/próprio; insuficiência não movimenta dinheiro |
| BE08 | 10 | Idempotência: replay sequencial e concorrente, conflito de payload, escopo por usuário, replay após restart |
| BE09 | 10 | Concorrência financeira: disputa por fundos, créditos recebidos concorrentes e conservação de dinheiro |
| BE10 | 10 | Saga/compensação: débito commitado antes de crédito, falha controlada, reembolso correto e passo idempotente |
| BE11 | 10 | Crash/recovery: retoma após débito persistido, finaliza sem duplicata, mantém integridade e trabalho durável |
| BE12 | 10 | CQRS/manutenção: caminhos separados, query sem escrita, domínio fora da route, testes e documentação com evidência |
| TOTAL | 100 | Nota de backend |

### BE01–BE05: cenários básicos

1. Em banco limpo, signin Alice retorna acc-alice/100000; Bruno 25000; Carla 0. GET /health responde ok.
2. Signup ` Nova Pessoa ` e ` NOVA@DEMO.LOCAL ` com senha válida retorna nome trim, e-mail lowercase, conta zero e sessão. Outro signup com e-mail equivalente retorna 409.
3. Reiniciar sem reset. Novo usuário ainda faz signin; seed não altera saldos. Inspecionar SQLite: não há senha plaintext nem senha em logs/respostas.
4. Signin inválido retorna INVALID_CREDENTIALS sem indicar se o e-mail existe. Cookie tem atributos exigidos; logout invalida a sessão anterior. Testar expiração por relógio controlado ou expiração do registro no SQLite do ambiente de teste; não esperar 24 horas.
5. Sem sessão, GET /me, saldo, contato, lookup e transferência retornam 401. Alice e Bruno não compartilham contatos. ID de transferência Alice consultado por Bruno retorna 404.
6. Tentar enviar `sourceAccountId`/`balanceCents` extra retorna 400 e não altera saldo. Origin não autorizado em POST retorna 403.
7. Alice cadastra Carla como contato: nickname `Carla`, destinatário acc-carla. Após restart, contato permanece. Duplicata 409; própria conta 422; inexistente 404.
8. Criar pelo menos cinco transferências, usar limit=2, percorrer até nextCursor=null e comparar todos os IDs à fotografia do histórico. Nenhuma duplicação/lacuna; cursor inválido 400. Não alterar dados durante essa verificação de paginação.

### BE06–BE08: valor e idempotência

1. Reset + signin Alice. Enviar 10001 a acc-bruno, chave `alice-bruno-001`. POST retorna 202 PENDING; GET do ID chega a COMPLETED. Alice=89999, Bruno=35001, Carla=0. Ledger tem exatamente um débito e um crédito de 10001.
2. Repetir mesma chave/payload: HTTP 200, mesmo ID/estado, saldos inalterados. Repetir depois de restart, com nova sessão: mesmo resultado.
3. Mesma chave com amountCents=10002 retorna 409. Chave ausente/curta/inválida retorna 400.
4. Reset. Enviar simultaneamente 10 POSTs de Alice com a mesma chave e payload. Aceitar um 202 e demais 200; todos compartilham ID, existe uma transferência/Saga, um débito e um crédito. Não aceitar 500/duplicação por corrida.
5. Bruno usa o mesmo texto de chave para outra transferência válida; operação independente, com novo ID.
6. amountCents=0, -1, 1.5, `"100"` e 100000001 retornam 400; própria conta 422; destino inexistente 404. Nenhuma Saga/movimentação criada por essas requisições inválidas.
7. Enviar 100001 de Alice em banco limpo: aceite 202, depois FAILED/INSUFFICIENT_FUNDS; Alice permanece100000 e Bruno25000; não há débito nem crédito.

### BE09: concorrência

1. Reset. Alice envia duas transferências de 70000 com chaves diferentes, uma a Bruno e outra a Carla, simultaneamente.
2. Exatamente uma termina COMPLETED; a outra FAILED/INSUFFICIENT_FUNDS. Alice=30000. Destinatário vencedor recebe 70000; perdedor não recebe. Soma=125000 e nenhum saldo negativo. Repetir o cenário três vezes com reset.
3. Reset. Alice envia 10000 a Carla e Bruno envia 5000 a Carla simultaneamente. Ambas completam; Carla=15000, Alice=90000, Bruno=20000. Detectar lost update no crédito.

### BE10: Saga e compensação

1. Verificar que, com controles desligados, /__test/* retorna 404; com flag ligada e token incorreto, 403.
2. Reset; armar FAIL_CREDIT_ONCE para acc-alice e chave `alice-fail-001`; enviar 10000 a Bruno.
3. Após terminal, FAILED/CREDIT_FAILED; Alice100000, Bruno25000, trânsito0. Ledger: um débito -10000 e uma compensação +10000 para Alice; nenhum crédito para Bruno.
4. Inspecionar código/logs/SQLite para confirmar commit local do débito e commit posterior da compensação. Um rollback da mesma transação envolvendo ambos não demonstra Saga.
5. Reexecutar a solicitação e/ou trabalho já processado por teste de integração documentado: nenhum reembolso extra. Transferência saudável posterior deve completar.
6. Verificar compensação sob outras operações: pausar uma transferência após débito de10000; Bruno envia5000 para Alice; provocar a falha de crédito da primeira pelo mecanismo de teste interno equivalente, ou um teste de integração controlado. Após compensação, Alice105000, Bruno20000. Nunca sobrescrever o saldo com snapshot100000. Se a implementação não permitir combinar os dois fault modes por API, executar esse subcaso via teste externo do orchestrator/repository sem mudar código de produção.

### BE11: recuperação real

1. Reset; armar PAUSE_AFTER_DEBIT para acc-alice e chave `alice-crash-001`; enviar10000 a Bruno. Esperar PROCESSING e confirmar Alice90000/Bruno25000; trânsito10000.
2. Matar o processo do backend sem shutdown gracioso, depois reiniciar com o mesmo DATABASE_PATH. Não resetar/seedar de forma destrutiva.
3. Em até10s, a mesma transferência chega a COMPLETED; Alice90000, Bruno35000; trânsito0. Não há segundo débito/crédito.
4. Reiniciar novamente e fazer replay da mesma chave/payload: mesmos ID, resultado e saldos. Sessão pode ser reutilizada se não expirou, ou signin novamente.
5. Inspecionar a retomada a partir do estado/job persistido. Uma fila somente em memória que perde o trabalho reprova.
6. Em todas as pausas e estados terminais, verificar a conservação: saldo de todas as contas + trânsito =125000. Antes do crédito é esperado trânsito positivo, sem classificar isso como dinheiro perdido.

### BE12: inspeção arquitetural

- [ ] Seguir RequestTransfer até command handler e GetBalance até query handler distintos.
- [ ] Queries não executam worker ou modificam domínio; rotas não concentram SQL/regras de transferência.
- [ ] CQRS permite DTOs de leitura e caminhos de escrita separados, mesmo compartilhando SQLite.
- [ ] Verificar constraints duráveis de idempotência e unicidade de passos.
- [ ] Testes cobrem comportamento real, não só mocks do banco ou nomes de funções.
- [ ] OpenAPI e README correspondem à execução observada; registrar divergências.

## 5. Frontend — checklist e pesos

| ID | Peso | Verificação e resultado esperado |
|---|---:|---|
| FE01 | 5 | Next/App Router/TypeScript, instalação/build e rotas executáveis |
| FE02 | 15 | Signup/signin/logout, validação, verificação de sessão e isolamento após troca de usuário |
| FE03 | 10 | Saldo/histórico, centavos, loading/empty/error e atualização após transferência |
| FE04 | 10 | Criar/reutilizar contato, lookup correto, erros de duplicata/próprio/inexistente |
| FE05 | 15 | Envio/revisão, destinatário certo, parsing monetário e confirmação única |
| FE06 | 10 | Processamento, sucesso, insuficiência/compensação, polling e retomada por ID |
| FE07 | 15 | Rede/timeout, replay com mesma chave/payload, reload e ausência de duplicata |
| FE08 | 5 | Modos mock/api e proxy, cookies e contrato sem lógica financeira duplicada |
| FE09 | 10 | Responsividade, teclado/foco, labels, mensagens e contraste |
| FE10 | 5 | Organização, cenários/testes documentados, runtime/console sem falhas |
| TOTAL | 100 | Nota de frontend |

### FE01–FE04: acesso e consultas

1. Build e typecheck. Abrir rota privada sem sessão: loading seguido de signin; não mostrar dados fictícios como autenticados.
2. Signup válido cria conta zero e abre dashboard. Confirmação de senha diferente impede submit. E-mail duplicado exibe mensagem corrigível, mantendo campos apropriados.
3. Signin Alice; saldo R$1.000,00 e IDacc-alice copiável. Credencial errada exibe erro genérico. Logout invalida sessão; usar back/reload não revela dados privados.
4. Entrar Bruno após Alice: não manter saldo, contatos, histórico ou tentativas pendentes da conta anterior. Forçar sessão expirada: redirecionamento correto e mensagem.
5. Simular API lenta, saldo indisponível e histórico vazio. Diferenciar loading/erro/zero/vazio. Retry recupera sem recarregar toda a página.
6. Cadastrar Carla, consultar nome, salvar e usar para transferência; contato reaparece após reload. Duplicata/própria/inexistente exibem mensagens claras.
7. Disparar lookup de Bruno com resposta lenta, trocar ID para Carla e responder Carla antes de Bruno: revisão deve mostrar Carla, sem sobrescrita pela resposta antiga.

### FE05–FE07: jornada financeira e rede

1. Alice escolhe Bruno, digita100,01 e nota. Revisão mostra Bruno, acc-bruno, R$100,01. Network confirma amountCents10001. Voltar/editar não envia POST.
2. Zero, negativo, mais de duas casas e limite excedido não passam na validação. Valor acima do saldo segue o resultado INSUFFICIENT_FUNDS do serviço, sem inventar aprovação.
3. Duplo clique/Enter repetido na confirmação não cria duas operações. Verificar Idempotency-Key, payload e saldo pelo serviço de referência.
4. Serviço mantém PENDING/PROCESSING: UI acompanha sem exibir sucesso. Quando completar, saldo/histórico atualizam. Reload do detalhe retoma pelo ID.
5. Falha de crédito retorna FAILED/CREDIT_FAILED: UI informa devolução e mostra saldo atualizado. Insuficiência mostra mensagem distinta e preserva saldo.
6. Serviço aceita POST mas corta a resposta antes de o browser recebê-la. UI mostra resultado desconhecido; retry conserva chave/payload. Depois de replay, apenas uma transferência e um débito existem.
7. Repetir cenário de resposta perdida com reload antes de retry. sessionStorage conserva tentativa, associada à conta; não gerar chave nova. Bloquear edição até resolver resultado anterior.
8. Perder respostas de polling: informar indisponibilidade de acompanhamento, não falha financeira. Retry/reabrir detalhe recupera. Após terminal/unmount/logout, não manter polling ativo.
9. Deixar PROCESSING por mais30s: frequência diminui e atualização manual existe. Navegar/voltar não duplica transferência.

### FE08–FE10: integração, UX e código

- [ ] Rodar mock isolado e api contra referência com mudança apenas de env; métodos, querystrings, cookies, status e erros preservados.
- [ ] API mode não usa fixtures para saldo real nem altera dados bancários localmente.
- [ ] Cookie de sessão não aparece em localStorage/sessionStorage ou leitura JS; nenhuma senha persistida no browser.
- [ ] Nas larguras375/1440, nenhum overflow ou botão escondido. Fluxos completos funcionam por teclado.
- [ ] Labels/foco/erros/announcements distinguem estados sem depender só de cor.
- [ ] Não há runtime error/hydration error; camada de acesso tipada evita fixtures espalhadas.
- [ ] Verificar ao menos dashboard, contatos, revisão, processamento e falha no browser; anexar evidência relevante.

## 6. Integração do par — resultado separado, sem diluir as notas

Todos os itens abaixo são obrigatórios para declarar INTEGRAÇÃO APROVADA. Esta seção não adiciona pontos às notas isoladas.

- [ ] Frontend em DATA_MODE=api; banco resetado; signup de Novo Demo cria conta zero e signin após logout funciona.
- [ ] Alice salva essa nova conta como contato.
- [ ] Alice envia10001 a Bruno pela UI; COMPLETED, Alice89999/Bruno35001.
- [ ] Alice envia2500 ao novo contato; COMPLETED, Alice87499/novo usuário2500.
- [ ] Entrar no novo usuário mostra R$25,00; entrar Bruno mostra R$350,01; Carla continua0. Soma de contas=125000.
- [ ] Reload e reinício preservam usuários, contatos, transferências e saldos. Reinício não recria dinheiro do seed.
- [ ] Uma falha controlada de crédito percorre Saga real e UI mostra valor devolvido, com estado financeiro correto.
- [ ] Replay após resposta perdida não duplica operação no SQLite; cookies e autorização funcionam através do proxy.

Se integração falhar, executar a mesma requisição contra cada componente de referência para localizar a origem. Classificar: backend, frontend, ambos, ambiente ou indeterminado. Não atribuir falha pelo fornecedor escolhido.

## 7. Formato do relatório final

### Identificação e resultado

| Campo | Valor a preencher |
|---|---|
| Modelo/versão e harness | Identificação observada |
| Código avaliado | Commit ou fingerprint + data |
| Ambiente | Node, SO, CPU/recursos e banco isolado |
| Backend | Nota/100, cobertura e veredito obrigatório |
| Frontend | Nota/100, cobertura e veredito obrigatório |
| Integração | Aprovada / Reprovada / Não verificada |
| Tempo/custo/tokens | Valores observados ou não disponíveis |
| Intervenções humanas | Quantidade e descrição |

### Evidência por item

| ID | Resultado | Pontos | Evidência | Impacto |
|---|---|---:|---|---|
| BE/FE correspondente | PASSA / PARCIAL / FALHA / NÃO VERIFICADO | peso×fator, ou não verificado | comando+exit code, HTTP, saldos antes/depois, arquivo/símbolo ou screenshot | efeito observado |

Inclua: falhas eliminatórias primeiro; passos mínimos de reprodução; distinção entre falha de implementação e limitação do ambiente; três ajustes prioritários. Não afirme “seguro para produção” a partir desta avaliação. O resultado mede o escopo local definido pelos PRDs.

### Lista final de decisão

- [ ] Jornadas obrigatórias executadas.
- [ ] Estado financeiro persistido e reconciliado.
- [ ] CQRS confirmado por inspeção.
- [ ] Saga confirmada por sucesso, compensação e crash/recovery.
- [ ] Idempotência e disputa por saldo demonstradas.
- [ ] Frontend validado isoladamente em browser.
- [ ] Resultado desconhecido e retry não duplicam envio.
- [ ] Contrato e integração verificados.
- [ ] Notas e cobertura separadas por lado.
- [ ] Evidência suficiente para outra pessoa reproduzir as conclusões.
