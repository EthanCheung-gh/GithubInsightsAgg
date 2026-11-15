import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getConfig } from './config';

export type SqlParam = string | number | bigint | null | Uint8Array;

type DbGlobal = typeof globalThis & { __gia_db__?: DatabaseSync };

let schemaCache: string | null = null;

function readSchemaSql(): string {
  if (schemaCache) return schemaCache;
  const attempts: Array<() => string> = [
    () => readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8'),
    () => readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'),
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const sql = attempt();
      if (sql.trim().length > 0) {
        schemaCache = sql;
        return sql;
      }
      errors.push('schema file is empty');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`unable to read db/schema.sql (${errors.join(' | ')})`);
}

function openDatabase(): DatabaseSync {
  const path = getConfig().databasePath;
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readSchemaSql());
  return db;
}

export function dbPath(): string {
  return getConfig().databasePath;
}

export function getDb(): DatabaseSync {
  const scope = globalThis as DbGlobal;
  if (!scope.__gia_db__) {
    scope.__gia_db__ = openDatabase();
  }
  return scope.__gia_db__;
}

export function resetDbForTests(): void {
  const scope = globalThis as DbGlobal;
  if (scope.__gia_db__) {
    try {
      scope.__gia_db__.close();
    } catch {
      // 已关闭则忽略
    }
    scope.__gia_db__ = undefined;
  }
}

export function all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T[] {
  const statement = getDb().prepare(sql);
  return statement.all(...params) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): T | null {
  const statement = getDb().prepare(sql);
  const row = statement.get(...params);
  return (row as T | undefined) ?? null;
}

export function run(
  sql: string,
  params: SqlParam[] = [],
): { changes: number; lastInsertRowid: number } {
  const statement = getDb().prepare(sql);
  const result = statement.run(...params);
  return {
    changes: Number(result.changes),
    lastInsertRowid: Number(result.lastInsertRowid),
  };
}

export function exec(sql: string): void {
  getDb().exec(sql);
}

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时保留原始错误
    }
    throw error;
  }
}
