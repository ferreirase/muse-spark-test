import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, pragmas, type Db } from './connection.js';
import { appliedVersions, migrate } from './migrate.js';

let dirs: string[] = [];
let dbs: Db[] = [];

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bank-test-'));
  dirs.push(dir);
  return join(dir, 'test.sqlite');
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bank-mig-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      /* já fechado */
    }
  }
  dbs = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('openDatabase', () => {
  it('aplica pragmas obrigatórios', () => {
    const db = openDatabase(tempFile());
    dbs.push(db);
    const p = pragmas(db);
    expect(p.journalMode.toLowerCase()).toBe('wal');
    expect(p.foreignKeys).toBe(1);
    expect(p.busyTimeout).toBeGreaterThan(0);
  });

  it('cria diretório pai se faltar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bank-nested-'));
    dirs.push(dir);
    const nested = join(dir, 'a', 'b', 'c.sqlite');
    const db = openDatabase(nested);
    dbs.push(db);
    expect(pragmas(db).foreignKeys).toBe(1);
  });

  it('recusa :memory:', () => {
    expect(() => openDatabase(':memory:')).toThrowError(/:memory:/);
  });
});

describe('migrate', () => {
  it('idempotente: 2ª execução não reaplica', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE t1 (id TEXT PRIMARY KEY);');
    writeFileSync(join(dir, '002_b.sql'), 'CREATE TABLE t2 (id TEXT PRIMARY KEY);');
    const db = openDatabase(tempFile());
    dbs.push(db);
    expect(migrate(db, dir)).toEqual(['001_a', '002_b']);
    expect(migrate(db, dir)).toEqual([]);
    expect(appliedVersions(db)).toEqual(['001_a', '002_b']);
  });

  it('migração com erro faz rollback e não grava versão', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '001_ok.sql'), 'CREATE TABLE ok1 (id TEXT PRIMARY KEY);');
    writeFileSync(join(dir, '002_bad.sql'), 'CREATE TABLE bad1 (id TEXT PRIMARY KEY);\nTHIS IS NOT SQL;');
    const db = openDatabase(tempFile());
    dbs.push(db);
    expect(() => migrate(db, dir)).toThrowError();
    expect(appliedVersions(db)).toEqual(['001_ok']);
    expect(() =>
      db.prepare("SELECT name FROM sqlite_master WHERE name='bad1'").get(),
    ).not.toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='bad1'").get()).toBeUndefined();
  });

  it('ordem por nome de arquivo respeitada', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '010_z.sql'), "INSERT INTO log (v) VALUES ('z');");
    writeFileSync(join(dir, '002_a.sql'), 'CREATE TABLE log (v TEXT);');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const db = openDatabase(tempFile());
    dbs.push(db);
    // 002 cria a tabela; 010 insere. Se a ordem fosse alfabética reversa, falharia.
    expect(migrate(db, dir)).toEqual(['002_a', '010_z']);
    expect(db.prepare('SELECT v FROM log').get()).toEqual({ v: 'z' });
  });
});
