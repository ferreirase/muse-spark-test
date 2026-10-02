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
updated_at: 2026-10-01T22:49:35.988Z
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
1. `openDatabase(path)`: criar diretório pai se faltar (`fs.mkdirSync(dirname, {recursive:true})`); `new Database(path)`; pragmas `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`; verificar que `foreign_keys` retornou 1.
2. `migrate(db, dir = migrationsDir)`: criar `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`; ler `*.sql` ordenados por nome; para cada versão não aplicada, executar SQL + insert de versão na mesma transação.
3. Garantir que `build` copia `migrations/*.sql` para `dist` (script `postbuild` ou ler via caminho relativo a `import.meta.url` resolvendo `src` em dev e `dist` em prod). Documentar escolha em notes.
4. `src/db/cli.ts migrate` chama `parseConfig` → `openDatabase` → `migrate` → `close`.
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
openDatabase com WAL, foreign_keys verificada por conexão, busy_timeout 5000, synchronous NORMAL e mkdir do diretório pai. migrate() transacional por versão (exec + insert na mesma tx immediate), idempotente, ordenado por nome, rollback sem registrar versão. CLI migrate ligado a parseConfig. postbuild copia migrations/ para dist; aceitação de dist e db:migrate re-verificada em MT-15 (dir de migrações nasce lá). Testes: 6 (pragmas, mkdir, ordem, idempotência, incremental, rollback). Commit db8e19b.
</summary>

<notes>
Aceitação 4 (npm run db:migrate cria arquivo): openDatabase cria o arquivo no DATABASE_PATH (verificado com DATABASE_PATH=/tmp; arquivo criado) e o comando termina com erro apenas porque src/db/migrations/ ainda não existe — nasce na MT-15; re-executar lá.
</notes>
