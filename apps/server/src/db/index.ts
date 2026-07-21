import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as schema from "./schema.ts";

const rawDataDir = process.env.DATA_DIR?.trim();
const dataDir =
  rawDataDir && rawDataDir.length > 0
    ? rawDataDir
    : join(import.meta.dir, "../../../../data");
mkdirSync(dataDir, { recursive: true });

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
  sqlite.exec("ALTER TABLE task_line_table ADD COLUMN difficulty INTEGER");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE task_line_table ADD COLUMN details_ciphertext TEXT");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE task_line_table ADD COLUMN details_iv TEXT");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE task_catalog_table ADD COLUMN difficulty_total INTEGER NOT NULL DEFAULT 0");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE task_catalog_table ADD COLUMN difficulty_count INTEGER NOT NULL DEFAULT 0");
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
try {
  sqlite.exec("ALTER TABLE user_table ADD COLUMN display_name TEXT");
} catch {
  /* column exists */
}
try {
  sqlite.exec("ALTER TABLE user_table ADD COLUMN greeting_style TEXT");
} catch {
  /* column exists */
}
// Voice-recording storage was removed in favor of dictation-to-text: drop the
// legacy pointer columns and purge any encrypted blobs left on disk. The
// recordings were never playable in-app (no decrypt/download path shipped).
function dropColumnIfExists(table: string, column: string) {
  try {
    sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("no such column") && !msg.includes("no such table")) {
      console.warn(`[eaj] could not drop ${table}.${column}: ${msg}`);
    }
  }
}
dropColumnIfExists("day_table", "audio_path");
dropColumnIfExists("day_table", "audio_iv");
try {
  rmSync(join(dataDir, "audio"), { recursive: true, force: true });
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn(`[eaj] could not remove legacy audio directory: ${msg}`);
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
  display_name TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  lat REAL,
  lon REAL,
  country TEXT DEFAULT 'US',
  temperature_unit TEXT,
  greeting_style TEXT,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  location_prompted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invite_code_table (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_user_id TEXT
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
  started_at INTEGER NOT NULL,
  opening_balance REAL NOT NULL,
  closing_balance REAL,
  phase TEXT NOT NULL DEFAULT 'plan',
  feel_rating INTEGER,
  journal_ciphertext TEXT,
  journal_iv TEXT,
  weather_json TEXT,
  is_holiday INTEGER NOT NULL DEFAULT 0,
  qualitative_ciphertext TEXT,
  qualitative_iv TEXT,
  compensate_note_ciphertext TEXT,
  compensate_note_iv TEXT
);

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
  completed INTEGER NOT NULL DEFAULT 0,
  difficulty INTEGER,
  details_ciphertext TEXT,
  details_iv TEXT
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
  difficulty_total INTEGER NOT NULL DEFAULT 0,
  difficulty_count INTEGER NOT NULL DEFAULT 0,
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

// Run after table creation: old databases still have the date-unique index and
// cannot accept the new duplicate-date model until that index is removed.
sqlite.exec("DROP INDEX IF EXISTS day_user_date");
try {
  sqlite.exec("ALTER TABLE day_table ADD COLUMN started_at INTEGER");
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("duplicate column name")) throw e;
}
sqlite.exec(`
UPDATE day_table
SET started_at =
  COALESCE(CAST(strftime('%s', date || 'T12:00:00Z') AS INTEGER) * 1000, 0)
  + (rowid % 1000)
WHERE started_at IS NULL;

-- If legacy data has several open dates, retain only the most recently started.
UPDATE day_table AS day
SET
  phase = 'closed',
  opening_balance = 100,
  closing_balance = 100 + COALESCE((
    SELECT SUM(
      CASE
        WHEN line.side = 'deposit' THEN COALESCE(line.actual_cost, line.planned_cost)
        ELSE -COALESCE(line.actual_cost, line.planned_cost)
      END
    )
    FROM task_line_table AS line
    WHERE line.day_id = day.id
  ), 0)
WHERE phase <> 'closed'
  AND EXISTS (
    SELECT 1
    FROM day_table AS newer
    WHERE newer.user_id = day.user_id
      AND newer.phase <> 'closed'
      AND (
        newer.started_at > day.started_at
        OR (newer.started_at = day.started_at AND newer.id > day.id)
      )
  );

-- Active legacy rows belong to the finite-day model immediately.
UPDATE day_table
SET opening_balance = 100
WHERE phase <> 'closed' AND opening_balance <> 100;

-- Recompute every closed row once per startup. This repairs rows force-closed
-- by an earlier migration and consistently applies the fresh-100 model.
UPDATE day_table AS day
SET
  opening_balance = 100,
  closing_balance = 100 + COALESCE((
    SELECT SUM(
      CASE
        WHEN line.side = 'deposit' THEN COALESCE(line.actual_cost, line.planned_cost)
        ELSE -COALESCE(line.actual_cost, line.planned_cost)
      END
    )
    FROM task_line_table AS line
    WHERE line.day_id = day.id
  ), 0)
WHERE phase = 'closed';

CREATE INDEX IF NOT EXISTS day_user_started_at
  ON day_table(user_id, started_at);
CREATE UNIQUE INDEX IF NOT EXISTS day_one_active_per_user
  ON day_table(user_id)
  WHERE phase <> 'closed';
`);

export const db = drizzle(sqlite, { schema });
export { dataDir, dbPath };
