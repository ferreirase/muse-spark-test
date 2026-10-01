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
updated_at: 2026-10-01T20:27:07.631Z
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
Executado conforme plano da task. Desvio: tipagem explícita de DEFAULTS para evitar literais (erro TS2322).
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
parseConfig tipado com defaults locais, validação agregada e 8 testes unitários passando. .env.example sem segredos.
</summary>
