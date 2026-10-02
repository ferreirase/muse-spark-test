---
id: MT-10
title: Configuração tipada por variáveis de ambiente (parseConfig + .env.example)
status: Done
priority: high
labels:
  - setup
  - unit-tests
parent: MT-1
dependencies:
  - MT-9
created_at: 2026-10-01T20:06:34.889Z
updated_at: 2026-10-01T22:43:09.080Z
---

<description>
Função pura `parseConfig(env)` em `src/config.ts` que lê e valida todas as variáveis de ambiente, aplica defaults locais e falha cedo com mensagem clara. Criar `.env.example` sem segredos reais.
</description>

<context>
- Variáveis e defaults: doc-1 §7.
- Contrato §4: backend em `http://127.0.0.1:3001`, frontend `http://127.0.0.1:3000`; cookie Secure só desligado no HTTP local.
- Contrato §8: controles só com `ENABLE_TEST_CONTROLS=true` **e** `TEST_CONTROL_TOKEN` explícito.
- PRD §6: `DATABASE_PATH` configurável, nunca apenas `:memory:` na execução do app.
- Carregar `.env` com `process.loadEnvFile()` do Node (stdlib) quando o arquivo existir; sem dotenv.
</context>

<plan>
1. Definir tipo `Config { host, port, databasePath, frontendOrigin, cookieSecure, logLevel, workerPollIntervalMs, testControls: { enabled, token } }`.
2. `parseConfig(env: Record<string,string|undefined>): Config` com defaults de doc-1 §7.
3. Validar: `port` inteiro 1–65535; `DATABASE_PATH` não vazio e diferente de `:memory:`; `FRONTEND_ORIGIN` URL válida sem path; booleanos aceitam só `true`/`false`; `ENABLE_TEST_CONTROLS=true` exige `TEST_CONTROL_TOKEN` com ≥ 16 caracteres.
4. Erro de config lança `Error` listando todas as variáveis inválidas de uma vez.
5. Criar `.env.example` com as chaves e comentários curtos.
</plan>

<acceptance>
- [x] `parseConfig({})` retorna defaults locais documentados
- [x] `DATABASE_PATH=:memory:` é rejeitado
- [x] `ENABLE_TEST_CONTROLS=true` sem token (ou token curto) é rejeitado
- [x] Valor booleano inválido (`yes`, `1`) é rejeitado com mensagem citando a variável
- [x] `.env.example` existe, cobre todas as chaves e não contém segredo real
- [x] Testes unitários passam
</acceptance>

<tests>
Arquivo `src/config.test.ts` (unitário, função pura):
- defaults com env vazio
- override de cada variável
- rejeições: porta inválida, `:memory:`, origin com path, booleano inválido, flag de teste sem token
- múltiplos erros reportados juntos
</tests>

<summary>
parseConfig puro em src/config.ts com todos os defaults do doc-1 §7, validação agregada de todos os erros de uma vez (PORT, DATABASE_PATH≠:memory:, FRONTEND_ORIGIN sem path, booleanos strict, token>=16 quando test controls on), loadConfig() com process.loadEnvFile silencioso e .env.example sem segredos. Testes: 8 casos (defaults, override, rejeições, erros múltiplos). Commit 7fd976e.
</summary>
