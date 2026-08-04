import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { databasePath, ensureDataDir, resolveDataDir } from "./config.ts";

function sqliteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function backupDatabase(dataDir = resolveDataDir(), now = new Date()): string {
  ensureDataDir(dataDir);
  const backupsDir = join(dataDir, "backups");
  mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = join(backupsDir, `eaj-${stamp}.sqlite`);
  const sqlite = new Database(databasePath(dataDir), { create: true });
  try {
    sqlite.exec("PRAGMA busy_timeout = 10000;");
    sqlite.exec(`VACUUM INTO ${sqliteLiteral(destination)}`);
    return destination;
  } finally {
    sqlite.close();
  }
}

if (import.meta.main) console.log(backupDatabase());
