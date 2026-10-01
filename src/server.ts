// Entrypoint: config → banco (migrate apenas; reinício normal não semeia nem
// reseta) → app → worker (logger real, wake via ref) → listen.
// Shutdown: worker → app → banco.
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { defaultClock } from './shared/clock.js';
import { createWorker } from './modules/worker/worker.js';
import { createPauseRegistry } from './modules/test-controls/pause-registry.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);

const pauseRegistry = createPauseRegistry();
let wake = (): void => undefined;
let getWorker = () => {
  throw new Error('worker ainda não criado');
};
const app = await buildApp({
  config,
  db,
  clock: defaultClock,
  onAccepted: () => wake(),
  getWorker: () => getWorker(),
  pauseRegistry,
});

const worker = createWorker({
  db,
  clock: defaultClock,
  pollIntervalMs: config.workerPollIntervalMs,
  pauseRegistry,
  logger: {
    info: (obj, msg) => app.log.info(obj, msg),
    warn: (obj, msg) => app.log.warn(obj, msg),
    error: (obj, msg) => app.log.error(obj, msg),
  },
});
wake = () => worker.wake();
getWorker = () => worker;

await app.listen({ port: config.port, host: config.host });
worker.start(); // boot: libera locks antigos e retoma sagas incompletas

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutdown gracioso iniciado');
  try {
    await worker.stop();
    await app.close();
  } finally {
    db.close();
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
