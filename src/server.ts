// Entrypoint: config → banco (migrate apenas; reinício normal não semeia nem
// reseta) → app → listen. Worker é plugado pela task do worker.
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { defaultClock } from './shared/clock.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
migrate(db);

const app = await buildApp({ config, db, clock: defaultClock });

await app.listen({ port: config.port, host: config.host });

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutdown gracioso iniciado');
  try {
    await app.close();
  } finally {
    db.close();
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
