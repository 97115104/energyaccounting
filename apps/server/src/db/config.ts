import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export function resolveDataDir(env = process.env): string {
  const configured = env.DATA_DIR?.trim();
  return configured && configured.length > 0
    ? configured
    : join(import.meta.dir, "../../../../data");
}

export function databasePath(dataDir = resolveDataDir()): string {
  return join(dataDir, "eaj.sqlite");
}

export function ensureDataDir(dataDir = resolveDataDir()): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return dataDir;
}

export function databaseExists(dataDir = resolveDataDir()): boolean {
  return existsSync(databasePath(dataDir));
}
