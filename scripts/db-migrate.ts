import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getConfig } from '../src/lib/config';

function readSchema(): string {
  const attempts: Array<() => string> = [
    () => readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'),
    () => readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8'),
  ];
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const sql = attempt();
      if (sql.trim()) return sql;
      errors.push('schema file is empty');
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`unable to read db/schema.sql (${errors.join(' | ')})`);
}

function main(): void {
  const config = getConfig();
  const dbPath = config.databasePath;
  mkdirSync(dirname(dbPath), { recursive: true });

  const schema = readSchema();
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(schema);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>;
    console.log(`[db:migrate] database: ${dbPath}`);
    console.log(`[db:migrate] tables (${tables.length}):`);
    for (const table of tables) {
      console.log(`  - ${table.name}`);
    }
    console.log('[db:migrate] ok');
  } finally {
    db.close();
  }
}

main();
