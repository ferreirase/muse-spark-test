import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFileIfPresent, parseConfig } from "../config.js";
import { openDatabase, closeDatabase } from "./connection.js";
import { migrate } from "./migrate.js";
import { seed, DEMO_PASSWORD } from "./seed.js";
import { reset } from "./reset.js";

function resolveDbPath(path: string): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const command = process.argv[2];
  const config = parseConfig(process.env);
  const dbPath = resolveDbPath(config.databasePath);
  const db = openDatabase(dbPath);

  try {
    switch (command) {
      case "migrate": {
        const applied = migrate(db);
        if (applied.length === 0) {
          console.log(`[db:migrate] no pending migrations (${dbPath})`);
        } else {
          for (const migration of applied) {
            console.log(`[db:migrate] applied ${migration.version}_${migration.name}`);
          }
        }
        break;
      }
      case "seed": {
        migrate(db);
        const result = await seed(db);
        if (result.inserted === 0) {
          console.log(`[db:seed] seed already present (${dbPath})`);
        } else {
          console.log(
            `[db:seed] inserted ${result.inserted} demo users (password: ${DEMO_PASSWORD})`,
          );
        }
        break;
      }
      case "reset": {
        migrate(db);
        await reset(db);
        console.log(`[db:reset] database reset to seed snapshot (${dbPath})`);
        break;
      }
      default:
        console.error("usage: db/cli.ts <migrate|seed|reset>");
        process.exitCode = 1;
    }
  } finally {
    closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
