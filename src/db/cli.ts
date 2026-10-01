import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';

// CLI: db:migrate | db:seed | db:reset (seed/reset entram em tasks seguintes)
const command = process.argv[2];

const config = loadConfig();
const db = openDatabase(config.databasePath);

switch (command) {
  case 'migrate':
    migrate(db);
    console.log(`migrations applied to ${config.databasePath}`);
    break;
  default:
    console.error(`uso: tsx src/db/cli.ts <migrate|seed|reset>`);
    process.exitCode = 1;
}

db.close();
