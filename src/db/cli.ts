import { parseConfig } from '../config.js';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import { resetDatabase, seed, totalBalances } from './seed.js';

const cmd = process.argv[2];
if (cmd !== 'migrate' && cmd !== 'seed' && cmd !== 'reset') {
  console.error(`Comando desconhecido: ${cmd ?? '(ausente)'}. Comandos: migrate | seed | reset`);
  process.exit(1);
}
if (process.env['DOTENV'] !== '0') {
  try {
    process.loadEnvFile();
  } catch {
    /* sem .env — usa env atual + defaults */
  }
}
const config = parseConfig(process.env as Record<string, string | undefined>);
const db = openDatabase(config.databasePath);
try {
  if (cmd === 'migrate') {
    const applied = migrate(db);
    console.log(applied.length === 0 ? 'Nenhuma migração pendente.' : `Aplicadas: ${applied.join(', ')}`);
  } else if (cmd === 'seed') {
    migrate(db);
    await seed(db);
    console.log(`Seed aplicado. Soma dos saldos: ${totalBalances(db)} centavos.`);
  } else {
    migrate(db);
    await resetDatabase(db);
    console.log(`Reset concluído. Soma dos saldos: ${totalBalances(db)} centavos.`);
  }
} finally {
  db.close();
}
