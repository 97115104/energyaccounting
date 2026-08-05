import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export type Migration = Readonly<{
  id: number;
  name: string;
  apply: (sqlite: Database, dataDir: string) => void;
}>;

type Column = Readonly<{ name: string }>;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function tableExists(sqlite: Database, table: string): boolean {
  return !!sqlite
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

function columnExists(sqlite: Database, table: string, column: string): boolean {
  if (!tableExists(sqlite, table)) return false;
  return (sqlite.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all() as Column[])
    .some((entry) => entry.name === column);
}

function addColumnIfMissing(sqlite: Database, table: string, column: string, definition: string): void {
  if (!tableExists(sqlite, table) || columnExists(sqlite, table, column)) return;
  sqlite.exec(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
}

function count(sqlite: Database, query: string): number {
  const row = sqlite.query(query).get() as { count: number } | null;
  return row?.count ?? 0;
}

function legacyStartBackfill(sqlite: Database): void {
  if (!columnExists(sqlite, "day_table", "started_at")) return;
  sqlite.exec(`
    UPDATE day_table
    SET started_at = COALESCE(
      started_at,
      CAST(strftime('%s', date || 'T12:00:00Z') AS INTEGER) * 1000,
      0
    )
    WHERE started_at IS NULL;
  `);
}

function assertSingleActiveDayInvariant(sqlite: Database): void {
  if (!tableExists(sqlite, "day_table")) return;
  const activeDays = count(
    sqlite,
    "SELECT COUNT(*) AS count FROM (SELECT user_id FROM day_table WHERE phase <> 'closed' GROUP BY user_id HAVING COUNT(*) > 1)",
  );
  if (activeDays > 0) {
    throw new Error(
      "Migration stopped: one or more users have multiple active energy days. Restore the backup and resolve those records explicitly; no history was changed.",
    );
  }
}

function assertCatalogInvariant(sqlite: Database): void {
  if (tableExists(sqlite, "task_catalog_table") && columnExists(sqlite, "task_catalog_table", "label_hash")) {
    const duplicateCatalogKeys = count(
      sqlite,
      "SELECT COUNT(*) AS count FROM (SELECT user_id, side, label_hash FROM task_catalog_table GROUP BY user_id, side, label_hash HAVING COUNT(*) > 1)",
    );
    if (duplicateCatalogKeys > 0) {
      throw new Error(
        "Migration stopped: duplicate derived catalog rows need an explicit catalog rebuild. No history was changed.",
      );
    }
  }
}

function purgeLegacyAudio(sqlite: Database, dataDir: string): void {
  if (columnExists(sqlite, "day_table", "audio_path")) {
    sqlite.exec("ALTER TABLE day_table DROP COLUMN audio_path");
  }
  if (columnExists(sqlite, "day_table", "audio_iv")) {
    sqlite.exec("ALTER TABLE day_table DROP COLUMN audio_iv");
  }
  const audioDir = join(dataDir, "audio");
  if (existsSync(audioDir)) rmSync(audioDir, { recursive: true, force: true });
}

const CREATE_CURRENT_TABLES = `
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
  include_physical_activities INTEGER NOT NULL DEFAULT 1,
  reveal_suggestions_when_empty INTEGER NOT NULL DEFAULT 1,
  onboarding_completed INTEGER NOT NULL DEFAULT 0,
  location_prompted INTEGER NOT NULL DEFAULT 0,
  identity_json TEXT,
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
  source_id TEXT,
  user_id TEXT NOT NULL REFERENCES user_table(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  closed_at INTEGER,
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
  source_id TEXT,
  day_id TEXT NOT NULL REFERENCES day_table(id) ON DELETE CASCADE,
  side TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  label_ciphertext TEXT NOT NULL,
  label_iv TEXT NOT NULL,
  label_hash TEXT NOT NULL DEFAULT '',
  planned_cost INTEGER NOT NULL,
  actual_cost INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
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
CREATE TABLE IF NOT EXISTS you_profile_table (
  user_id TEXT PRIMARY KEY REFERENCES user_table(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS share_snapshot_table (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_table(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  is_permanent INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE TABLE IF NOT EXISTS weather_cache_table (
  id TEXT PRIMARY KEY,
  lat_key TEXT NOT NULL,
  lon_key TEXT NOT NULL,
  date TEXT NOT NULL,
  payload TEXT NOT NULL
);
`;

function adoptLegacySchema(sqlite: Database, dataDir: string): void {
  sqlite.exec(CREATE_CURRENT_TABLES);
  // This is deliberately the first data preflight. A bad legacy active-day
  // state must not trigger a balance, phase, or timestamp rewrite.
  assertSingleActiveDayInvariant(sqlite);

  addColumnIfMissing(sqlite, "task_line_table", "label_hash", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(sqlite, "task_line_table", "completed", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "task_line_table", "completed_at", "INTEGER");
  addColumnIfMissing(sqlite, "task_line_table", "difficulty", "INTEGER");
  addColumnIfMissing(sqlite, "task_line_table", "details_ciphertext", "TEXT");
  addColumnIfMissing(sqlite, "task_line_table", "details_iv", "TEXT");
  addColumnIfMissing(sqlite, "task_line_table", "source_id", "TEXT");
  addColumnIfMissing(sqlite, "task_catalog_table", "difficulty_total", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "task_catalog_table", "difficulty_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "day_table", "started_at", "INTEGER");
  addColumnIfMissing(sqlite, "day_table", "closed_at", "INTEGER");
  addColumnIfMissing(sqlite, "day_table", "source_id", "TEXT");
  addColumnIfMissing(sqlite, "share_snapshot_table", "is_permanent", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "user_table", "onboarding_completed", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(sqlite, "user_table", "location_prompted", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(sqlite, "user_table", "temperature_unit", "TEXT");
  addColumnIfMissing(sqlite, "user_table", "display_name", "TEXT");
  addColumnIfMissing(sqlite, "user_table", "greeting_style", "TEXT");
  addColumnIfMissing(sqlite, "user_table", "identity_json", "TEXT");
  addColumnIfMissing(sqlite, "user_table", "include_physical_activities", "INTEGER NOT NULL DEFAULT 1");
  addColumnIfMissing(sqlite, "user_table", "reveal_suggestions_when_empty", "INTEGER NOT NULL DEFAULT 1");

  legacyStartBackfill(sqlite);
  sqlite.exec("DROP INDEX IF EXISTS day_user_date");
  assertCatalogInvariant(sqlite);
  sqlite.exec(`
    UPDATE day_table SET closed_at = started_at WHERE phase = 'closed' AND closed_at IS NULL;
    UPDATE task_line_table
    SET completed_at = COALESCE((SELECT closed_at FROM day_table WHERE id = task_line_table.day_id),
      (SELECT started_at FROM day_table WHERE id = task_line_table.day_id))
    WHERE completed = 1 AND completed_at IS NULL;
    UPDATE day_table SET source_id = id WHERE source_id IS NULL;
    UPDATE task_line_table SET source_id = id WHERE source_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS weather_loc_date ON weather_cache_table(lat_key, lon_key, date);
    CREATE INDEX IF NOT EXISTS day_user_started_at ON day_table(user_id, started_at);
    CREATE INDEX IF NOT EXISTS day_user_closed_at ON day_table(user_id, closed_at);
    CREATE UNIQUE INDEX IF NOT EXISTS day_user_source_id ON day_table(user_id, source_id);
    CREATE UNIQUE INDEX IF NOT EXISTS task_line_day_source_id ON task_line_table(day_id, source_id);
    CREATE UNIQUE INDEX IF NOT EXISTS task_catalog_user_side_hash ON task_catalog_table(user_id, side, label_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS day_one_active_per_user ON day_table(user_id) WHERE phase <> 'closed';
  `);
}

export const MIGRATIONS: readonly Migration[] = [
  { id: 1, name: "adopt-current-schema-without-history-rewrites", apply: adoptLegacySchema },
  // Retired voice blobs are intentionally purged once, only after the caller
  // has made a verified backup. No future schema includes an audio path.
  { id: 2, name: "purge-retired-audio-storage", apply: purgeLegacyAudio },
  {
    id: 3,
    name: "add-empty-column-suggestion-preference",
    apply: (sqlite) =>
      addColumnIfMissing(
        sqlite,
        "user_table",
        "reveal_suggestions_when_empty",
        "INTEGER NOT NULL DEFAULT 1",
      ),
  },
];
