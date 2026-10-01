import { loadConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { seed, resetDatabase } from './seed.js';

// CLI: db:migrate | db:seed | db:reset
const command = process.argv[2];

const config = loadConfig();
const db = openDatabase(config.databasePath);

switch (command) {
  case 'migrate':
    migrate(db);
    console.log(`migrations applied to ${config.databasePath}`);
    break;
  case 'seed':
    migrate(db);
    await seed(db);
    console.log(`seed ensured in ${config.databasePath}`);
    break;
  case 'reset':
    migrate(db);
    await resetDatabase(db);
    console.log(`database reset to seed in ${config.databasePath}`);
    break;
  default:
    console.error('uso: tsx src/db/cli.ts <migrate|seed|reset>');
    process.exitCode = 1;
}

db.close();
