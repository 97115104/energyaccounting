import { Database } from "bun:sqlite";
import { databasePath, ensureDataDir, resolveDataDir } from "./config.ts";
import { MIGRATIONS } from "./migrations.ts";

type AppliedMigration = Readonly<{ id: number; name: string }>;

function createMigrationLedger(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

export function currentMigrationId(): number {
  return MIGRATIONS.at(-1)?.id ?? 0;
}

export function migrateDatabase(dataDir = resolveDataDir()): AppliedMigration[] {
  ensureDataDir(dataDir);
  const sqlite = new Database(databasePath(dataDir), { create: true });
  try {
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
    createMigrationLedger(sqlite);
    const applied = new Set(
      (sqlite.query("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map((row) => row.id),
    );
    const migrated: AppliedMigration[] = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        migration.apply(sqlite, dataDir);
        sqlite
          .query("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.id, migration.name, Date.now());
        sqlite.exec("COMMIT");
        migrated.push({ id: migration.id, name: migration.name });
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
    return migrated;
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) {
  const migrated = migrateDatabase();
  const summary = migrated.length
    ? migrated.map((migration) => `${migration.id}:${migration.name}`).join(", ")
    : "already current";
  console.log(`[eaj] database migration: ${summary}`);
}
