---
id: MT-13
title: Conexão SQLite (pragmas) e runner de migrações versionadas
status: Done
priority: high
labels:
  - db
  - unit-tests
parent: MT-2
dependencies:
  - MT-10
created_at: 2026-10-01T20:07:12.508Z
updated_at: 2026-10-01T20:31:06.255Z
---

<description>
`openDatabase(path)` que abre o arquivo SQLite com pragmas obrigatórios e `migrate(db)` que aplica arquivos `.sql` versionados em ordem, uma vez cada, registrando em `schema_migrations`. Base para todo o resto da persistência.
</description>

<context>
- PRD §6: arquivo configurável por `DATABASE_PATH`; habilitar foreign keys em **cada** conexão; tratamento de lock/busy apropriado; migrações reproduzíveis; reinício normal não executa reset.
- PRD §5 regra 6: `SQLITE_BUSY` é falha transitória tratada com retry (na Saga), mas a conexão já deve ter `busy_timeout`.
- Driver: `better-sqlite3` (doc-1 §2). Transações de escrita usam `db.transaction(fn).immediate()` para pegar o write lock no início e evitar race leitura→escrita.
- Arquivos: `src/db/connection.ts`, `src/db/migrate.ts`, `src/db/migrations/`.
</context>

<plan>
Executado conforme plano. postbuild copia migrations para dist (verificado com dir vazio; 001 chega em MT-15). cli.ts só com `migrate` por enquanto — seed/reset em MT-17.
</plan>

<acceptance>
- [x] Toda conexão aberta por `openDatabase` tem `foreign_keys=1`, WAL e `busy_timeout` > 0
- [x] `migrate` aplicado duas vezes seguidas não reaplica nem falha
- [x] Migração com erro faz rollback e não grava versão
- [x] `npm run db:migrate` cria o arquivo no `DATABASE_PATH`
- [x] `npm run build && npm start` encontra as migrações em `dist`
- [x] Testes unitários passam
</acceptance>

<tests>
`src/db/migrate.test.ts` com SQLite temporário em arquivo (`mkdtempSync`), nunca `:memory:`:
- pragmas aplicados após `openDatabase`
- idempotência: 2ª execução não muda `schema_migrations`
- diretório de migrações fake com SQL inválido → rollback, versão não registrada
- ordem por nome de arquivo respeitada
</tests>

<summary>
openDatabase com WAL/FK/busy_timeout + migrate idempotente com rollback. 6 testes em arquivo temporário, typecheck ok, db:migrate e build+postbuild verificados.
</summary>
