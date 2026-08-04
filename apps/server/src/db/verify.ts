import { Database } from "bun:sqlite";
import { databaseExists, databasePath, resolveDataDir } from "./config.ts";
import { currentMigrationId } from "./migrate.ts";

export type DatabaseVerification = Readonly<{
  integrity: string;
  foreignKeyViolations: number;
  currentMigration: number;
}>;

export function assertDatabaseCurrent(dataDir = resolveDataDir()): DatabaseVerification {
  if (!databaseExists(dataDir)) {
    throw new Error("Database is not initialized. Run `bun run db:migrate` before starting EAJ.");
  }
  const sqlite = new Database(databasePath(dataDir), { readonly: true });
  try {
    const ledger = sqlite.query("SELECT MAX(id) AS id FROM schema_migrations").get() as { id: number | null };
    const currentMigration = ledger.id ?? 0;
    if (currentMigration !== currentMigrationId()) {
      throw new Error("Database schema is outdated. Run `bun run db:migrate` before starting EAJ.");
    }
    const integrity = (sqlite.query("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (integrity !== "ok") throw new Error(`Database integrity check failed: ${integrity}`);
    const foreignKeyViolations = sqlite.query("PRAGMA foreign_key_check").all().length;
    if (foreignKeyViolations > 0) throw new Error("Database foreign-key check failed.");
    return { integrity, foreignKeyViolations, currentMigration };
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) console.log(JSON.stringify(assertDatabaseCurrent()));
