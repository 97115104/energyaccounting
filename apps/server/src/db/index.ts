import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema.ts";

const dataDir = process.env.DATA_DIR ?? join(import.meta.dir, "../../../../data");
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, "audio"), { recursive: true });

const dbPath = join(dataDir, "eaj.sqlite");
const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA journal_mode = WAL;");

// Lightweight migrations for existing local DBs
try {
  sqlite.exec("ALTER TABLE task_line_table ADD COLUMN label_hash TEXT NOT NULL DEFAULT ''");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE task_line_table ADD COLUMN completed INTEGER NOT NULL DEFAULT 0");
} catch {
  /* column exists */
}
try {
  sqlite.exec(
    "ALTER TABLE user_table ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 1",
  );
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE user_table ADD COLUMN location_prompted INTEGER NOT NULL DEFAULT 0");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE user_table ADD COLUMN temperature_unit TEXT");
} catch {
  /* column exists */
}

sqlite.exec(`
CREATE TABLE IF NOT EXISTS user_table (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  kek_salt TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  recovery_codes_hash TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  lat REAL,
  lon REAL,
  country TEXT DEFAULT 'US',
  temperature_unit TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  location_prompted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_table (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_table(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  pending_totp INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS day_table (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_table(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  opening_balance REAL NOT NULL,
  closing_balance REAL,
  phase TEXT NOT NULL DEFAULT 'plan',
  feel_rating INTEGER,
  journal_ciphertext TEXT,
  journal_iv TEXT,
  audio_path TEXT,
  audio_iv TEXT,
  weather_json TEXT,
  is_holiday INTEGER NOT NULL DEFAULT 0,
  qualitative_ciphertext TEXT,
  qualitative_iv TEXT,
  compensate_note_ciphertext TEXT,
  compensate_note_iv TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS day_user_date ON day_table(user_id, date);

CREATE TABLE IF NOT EXISTS task_line_table (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES day_table(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  label_ciphertext TEXT NOT NULL,
  label_iv TEXT NOT NULL,
  label_hash TEXT NOT NULL DEFAULT '',
  planned_cost INTEGER NOT NULL,
  actual_cost INTEGER,
  completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_catalog_table (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_table(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  label_ciphertext TEXT NOT NULL,
  label_iv TEXT NOT NULL,
  label_hash TEXT NOT NULL,
  typical_cost INTEGER NOT NULL DEFAULT 20,
  weekday_mask INTEGER NOT NULL DEFAULT 127,
  use_count INTEGER NOT NULL DEFAULT 1,
  last_used TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weather_cache_table (
  id TEXT PRIMARY KEY,
  lat_key TEXT NOT NULL,
  lon_key TEXT NOT NULL,
  date TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS weather_loc_date ON weather_cache_table(lat_key, lon_key, date);
`);

export const db = drizzle(sqlite, { schema });
export { dataDir, dbPath };
