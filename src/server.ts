import { parseConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { systemClock } from './shared/clock.js';
import { runSaga } from './modules/transfers/saga/orchestrator.js';
import { createFaultHooks } from './modules/test-controls/fault-hooks.js';
import { PauseRegistry } from './modules/test-controls/pause-registry.js';
import { createWorker, type Worker } from './modules/worker/worker.js';

try {
  process.loadEnvFile();
} catch {
  /* sem .env — usa env atual + defaults */
}

const config = parseConfig(process.env as Record<string, string | undefined>);
const db = openDatabase(config.databasePath);
// Reinício normal só migra — nunca semeia nem reseta.
migrate(db);

let worker: Worker | null = null;
// Faults reais só com flag ligada (desligada → hooks no-op, tabela intocada).
const faultSet = config.testControls.enabled
  ? createFaultHooks({ db, now: () => new Date().toISOString(), signal: undefined })
  : null;
if (faultSet !== null) {
  (globalThis as { __testPauseRegistry?: PauseRegistry }).__testPauseRegistry = faultSet.pauseRegistry;
}
// Worker criado ANTES do app para que o handler de RequestTransfer já tenha wake.
// start() só após listen (retoma jobs persistidos).
const earlyWorker = createWorker({
  db,
  clock: systemClock,
  pollIntervalMs: config.workerPollIntervalMs,
  runSaga: (transferId) =>
    runSaga(
      {
        db,
        now: () => new Date().toISOString(),
        hooks: faultSet?.hooks ?? loadTestHooks(),
        signal: testAbortSignal(),
      },
      transferId,
    ),
});
worker = earlyWorker;
const app = buildApp({
  config,
  db,
  clock: systemClock,
  worker: earlyWorker,
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'encerrando');
  try {
    await app.close();
  } finally {
    if (worker !== null) await worker.stop();
    db.close();
  }
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void shutdown(sig);
  });
}

await app.listen({ host: config.host, port: config.port });

// Worker após listen: retoma jobs persistidos e processa novos (wake via POST).
earlyWorker.start();

globalThis.__testAbortSignal ??= new AbortController();
globalThis.__testAbortReplace ??= () => {
  globalThis.__testAbortSignal = new AbortController();
};

function loadTestHooks(): {
  afterDebit?: (t: { id: string; sourceAccountId: string; idempotencyKey: string }) => Promise<void>;
  beforeCredit?: (t: { id: string; sourceAccountId: string; idempotencyKey: string }) => 'FAIL' | 'CONTINUE';
} {
  return globalThis.__testSagaHooks ?? {};
}
function testAbortSignal(): AbortSignal | undefined {
  // Com faults reais, a pausa usa PauseRegistry (release), não AbortSignal.
  if (faultSet !== null) return undefined;
  return globalThis.__testAbortSignal?.signal;
}
