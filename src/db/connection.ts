import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/** Abre o SQLite com pragmas obrigatórios. Cria o diretório pai se faltar. */
export function openDatabase(path: string): Db {
  if (path === ':memory:') {
    throw new Error('openDatabase recusa :memory: — use um arquivo configurável');
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  const fk = db.pragma('foreign_keys', { simple: true }) as number;
  if (fk !== 1) {
    db.close();
    throw new Error('foreign_keys não pôde ser habilitado nesta conexão');
  }
  return db;
}

export function pragmas(db: Db): { journalMode: string; foreignKeys: number; busyTimeout: number } {
  return {
    journalMode: String(db.pragma('journal_mode', { simple: true })),
    foreignKeys: Number(db.pragma('foreign_keys', { simple: true })),
    busyTimeout: Number(db.pragma('busy_timeout', { simple: true })),
  };
}
