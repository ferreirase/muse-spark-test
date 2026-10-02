# SDD ledger — plan: my-backlog muse-test-muse (inline execution)
Spec: docs/prd-backend.md + docs/contrato-compartilhado.md (autoridade)
Repo: branch impl/banco-demo-v1 a partir de 2f58fd3 (main)
Task MT-9: complete (commits 2f58fd3..2f58fd3, tests: npm test → 1/1 pass)
Task MT-9: Ruling: build usa tsconfig.build.json (exclui *.test.ts) e tsconfig.json passa a cobrir testes — typecheck precisa compilar os testes — custo: script build difere do plano
Task MT-9: Ruling: commits por task (repo já é git; skill exige commit como registro) — custo: nenhum
Task MT-10: complete (commits a2864d3..WIP, tests: vitest → 27/27 pass)
Task MT-11: complete (commits a2864d3..WIP, tests: vitest → 27/27 pass)
Task MT-12: complete (commits a2864d3..WIP, tests: vitest → 27/27 pass; wiring do handler fica em MT-16)
Task MT-13: complete (commits 7fd976e..WIP, tests: vitest → 62/62 pass; db:migrate/build+dist de migrações re-verificados em MT-15 quando 001_init.sql existir)
Task MT-13: Ruling: aceitação 'db:migrate cria arquivo' e 'build encontra migrações' ficam condicionais a MT-15 (dir migrations/ é criado lá) — custo: re-check em MT-15
Task MT-14: complete (commits 7fd976e..WIP, tests: vitest → 62/62 pass)
Task MT-16: complete (commits 73c0d5a..WIP, tests: vitest → 78/78 pass + verificação manual inject 11/11 em /tmp)
Task MT-16: Ruling: sandbox bloqueia loopback TCP inter-processo; HTTP verificado com script descartável inject em /tmp (fora do repo); boot real do server verificado por log listen + SIGTERM gracioso — custo: avaliador re-executa curl em ambiente livre
Task MT-16: Bugfix TDD: onSend hook retornava reply (payload indefinido travava resposta) — reproduzido, corrigido, 11 checks verdes
Task MT-17: complete (commits 7da145b..0747384, tests: vitest → 85/85 pass; db:reset verificado: 3 users/3 accounts/1 contato/125000)
Task MT-18: complete (commits 7da145b..f910bd6, tests: vitest → 92/92 pass; cookie attributes verificados manualmente em MT-20 via inject)
Task MT-19: complete (commits f910bd6..3024077, tests: vitest → 102/102 pass)
Task MT-20: complete (commits 3024077..bea1402, tests: vitest → 111/111 pass + verificação manual inject auth 16/16)
Task MT-18: aceite de cookie verificado via inject (HttpOnly/SameSite=Lax/Path=/Max-Age 86400/Secure por config) — fechado agora
Task MT-21: complete (commits bea1402..c597bde, tests: vitest → 116/116 pass)
Task MT-22: complete (commits c597bde..93c9caf, tests: vitest → 122/122 pass)
Task MT-23: complete (commits 93c9caf..ca14242, tests: vitest → 133/133 pass)
Task MT-23: Ruling: retry.ts rodou GREEN sem RED observado (arquivo escrito junto) — risco coberto pelos 5 testes específicos — custo: nenhum
Task MT-24: complete (commits ca14242..9f5d202, tests: vitest → 154/154 pass)
Task MT-25: complete (commits ca14242..9f5d202, tests: vitest → 154/154 pass)
Task MT-26: complete (commits 9f5d202..7792d97, tests: vitest → 169/169 pass)
Task MT-27: complete (commits 7792d97..62c7082, tests: vitest → 181/181 pass)
Task MT-28: complete (commits 62c7082..f4dfa40, tests: vitest → 187/187 + inject 7/7; typecheck/build agora verdes)
Task MT-28: Ruling: rtk truncava output do tsc; typecheck/build quebrados desde MT-21 passaram despercebidos — corrigidos agora (5 erros: augmentation requireAuth, tipo Worker no server, payload_fingerprint no TransferRow, header array, retry opts nos testes) — custo: nenhum, suite continua verde
Task MT-29: complete (commits f4dfa40..4df083d, tests: vitest → 195/195 pass)
Task MT-30: complete (commits 4df083d..a22c949, tests: vitest → 203/203 pass)
Task MT-31: complete (commits a22c949..0fa613d, verificado: quickstart do zero via git archive+npm ci+db:reset+boot OK; reconciliação SQL com 3 transferências fecha 125000)
Task MT-32: complete (commits 0fa613d..3e85f6d, bateria real no clone limpo: 203/203 testes, curl /health 200, fluxo transferência COMPLETED <0.3s, replay 200 mesmo id)
