import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { databasePath, resolveDataDir } from "./config.ts";
import * as schema from "./schema.ts";
import { assertDatabaseCurrent } from "./verify.ts";

const dataDir = resolveDataDir();
const dbPath = databasePath(dataDir);

// Application imports never evolve the schema. Deployment and development
// wrappers run db:migrate first; this guard makes an unsafe direct start fail.
assertDatabaseCurrent(dataDir);
const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");

export const db = drizzle(sqlite, { schema });
export { dataDir, dbPath };
