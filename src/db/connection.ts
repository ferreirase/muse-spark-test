import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Abre (ou cria) o arquivo SQLite com os pragmas obrigatórios do PRD §6.
 * FK verificada em cada conexão; WAL + busy_timeout para o worker coexistir
 * com a API sem SQLITE_BUSY imediato.
 */
export function openDatabase(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  const fk = db.pragma('foreign_keys', { simple: true });
  if (fk !== 1) {
    db.close();
    throw new Error(`foreign_keys não pôde ser habilitado em ${path}`);
  }
  return db;
}
