import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './connection.js';
import { migrate } from './migrate.js';
import type Database from 'better-sqlite3';

let dir: string;
let db: Database.Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'muse-db-'));
  db = openDatabase(join(dir, 'test.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('aplica pragmas obrigatórios (WAL, FK, busy_timeout)', () => {
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBeGreaterThan(0);
    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
  });

  it('cria diretório pai quando não existe', () => {
    const nested = join(dir, 'a/b/c/app.sqlite');
    const db2 = openDatabase(nested);
    expect(db2.pragma('foreign_keys', { simple: true })).toBe(1);
    db2.close();
  });
});

describe('migrate', () => {
  const writeMigrations = (files: Record<string, string>) => {
    const mdir = join(dir, 'migrations');
    mkdirSync(mdir, { recursive: true });
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(mdir, name), sql);
    return mdir;
  };

  it('aplica migrações em ordem e registra versões', () => {
    const mdir = writeMigrations({
      '001_a.sql': 'CREATE TABLE ta(id INTEGER);',
      '002_b.sql': 'CREATE TABLE tb(id INTEGER);',
      '010_c.sql': 'CREATE TABLE tc(id INTEGER);',
    });
    migrate(db, mdir);
    const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((r) => r.version);
    expect(versions).toEqual(['001_a', '002_b', '010_c']);
    const tables = readdirSync('.'); // smoke: sem throw
    expect(tables.length).toBeGreaterThan(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='tc'").get()).toBeTruthy();
  });

  it('é idempotente: segunda execução não reaplica', () => {
    const mdir = writeMigrations({
      '001_a.sql': 'CREATE TABLE ta(id INTEGER);',
    });
    migrate(db, mdir);
    const applied = db.prepare('SELECT COUNT(*) c FROM schema_migrations').get() as { c: number };
    migrate(db, mdir);
    const applied2 = db.prepare('SELECT COUNT(*) c FROM schema_migrations').get() as { c: number };
    expect(applied.c).toBe(1);
    expect(applied2.c).toBe(1);
  });

  it('migração nova é aplicada junto às antigas já registradas', () => {
    const mdir = writeMigrations({ '001_a.sql': 'CREATE TABLE ta(id INTEGER);' });
    migrate(db, mdir);
    writeFileSync(join(mdir, '002_b.sql'), 'CREATE TABLE tb(id INTEGER);');
    migrate(db, mdir);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='tb'").get()).toBeTruthy();
  });

  it('SQL inválido faz rollback e não grava a versão', () => {
    const mdir = writeMigrations({
      '001_ok.sql': 'CREATE TABLE ta(id INTEGER);',
      '002_bad.sql': 'CREATE TABLE tb(id INTEGER); ESTE SQL É INVÁLIDO(;',
    });
    expect(() => migrate(db, mdir)).toThrow();
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version);
    expect(versions).toEqual(['001_ok']);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='tb'").get()).toBeFalsy();
  });
});
