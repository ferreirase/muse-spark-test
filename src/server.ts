import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFileIfPresent, parseConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import { systemClock } from "./shared/clock.js";
import { buildApp } from "./app.js";
import { closeDatabase } from "./db/connection.js";

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = parseConfig(process.env);
  const dbPath = resolve(config.databasePath);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = openDatabase(dbPath);
  migrate(db);
  await seed(db, { clock: systemClock });

  const { app, worker } = await buildApp({ db, config, clock: systemClock });

  worker.recoverOnBoot();
  worker.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    await worker.stop();
    await app.close();
    closeDatabase(db);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { databasePath: dbPath, testControls: config.enableTestControls },
    "Banco Demo backend ready",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
