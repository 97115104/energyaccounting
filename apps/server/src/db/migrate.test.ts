import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDatabase } from "./backup.ts";
import { migrateDatabase } from "./migrate.ts";
import { assertDatabaseCurrent } from "./verify.ts";

function legacyDir(prefix: string): string {
  const directory = join(tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function makeLegacyDatabase(directory: string, sql: string): void {
  const sqlite = new Database(join(directory, "eaj.sqlite"), { create: true });
  sqlite.exec(sql);
  sqlite.close();
}

describe("versioned database migration", () => {
  test("backfills only metadata, purges legacy audio once, and is idempotent", () => {
    const directory = legacyDir("eaj-migration");
    try {
      makeLegacyDatabase(directory, `
        CREATE TABLE day_table (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL,
          opening_balance REAL NOT NULL, closing_balance REAL, phase TEXT NOT NULL,
          audio_path TEXT, audio_iv TEXT
        );
        CREATE TABLE task_line_table (
          id TEXT PRIMARY KEY, day_id TEXT NOT NULL, side TEXT NOT NULL,
          sort INTEGER NOT NULL, label_ciphertext TEXT NOT NULL, label_iv TEXT NOT NULL,
          planned_cost INTEGER NOT NULL, actual_cost INTEGER, completed INTEGER NOT NULL
        );
        INSERT INTO day_table VALUES ('day', 'person', '2026-08-01', 75, 42, 'closed', 'old.webm', 'iv');
        INSERT INTO task_line_table VALUES ('line', 'day', 'deposit', 0, 'ct', 'iv', 12, 12, 1);
      `);
      mkdirSync(join(directory, "audio"));
      writeFileSync(join(directory, "audio", "old.webm"), "retired");

      expect(migrateDatabase(directory)).toHaveLength(2);
      expect(migrateDatabase(directory)).toEqual([]);
      expect(assertDatabaseCurrent(directory).currentMigration).toBe(2);

      const sqlite = new Database(join(directory, "eaj.sqlite"), { readonly: true });
      const day = sqlite.query("SELECT opening_balance, closing_balance, phase, source_id, started_at, closed_at FROM day_table").get() as Record<string, unknown>;
      const line = sqlite.query("SELECT source_id, completed_at FROM task_line_table").get() as Record<string, unknown>;
      expect(day.opening_balance).toBe(75);
      expect(day.closing_balance).toBe(42);
      expect(day.phase).toBe("closed");
      expect(day.source_id).toBe("day");
      expect(day.started_at).not.toBeNull();
      expect(day.closed_at).not.toBeNull();
      expect(line.source_id).toBe("line");
      expect(line.completed_at).not.toBeNull();
      expect((sqlite.query("PRAGMA table_info(day_table)").all() as Array<{ name: string }>).some((row) => row.name === "audio_path")).toBe(false);
      sqlite.close();
      expect(existsSync(join(directory, "audio"))).toBe(false);

      const snapshot = backupDatabase(directory);
      expect(existsSync(snapshot)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("aborts conflicting active legacy days before changing historical rows", () => {
    const directory = legacyDir("eaj-migration-conflict");
    try {
      makeLegacyDatabase(directory, `
        CREATE TABLE day_table (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL,
          opening_balance REAL NOT NULL, closing_balance REAL, phase TEXT NOT NULL
        );
        INSERT INTO day_table VALUES ('one', 'person', '2026-08-01', 80, NULL, 'plan');
        INSERT INTO day_table VALUES ('two', 'person', '2026-08-02', 30, NULL, 'audit');
      `);
      expect(() => migrateDatabase(directory)).toThrow("multiple active energy days");
      const sqlite = new Database(join(directory, "eaj.sqlite"), { readonly: true });
      expect(sqlite.query("SELECT opening_balance FROM day_table WHERE id = 'one'").get()).toEqual({ opening_balance: 80 });
      expect((sqlite.query("PRAGMA table_info(day_table)").all() as Array<{ name: string }>).some((row) => row.name === "started_at")).toBe(false);
      sqlite.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("refuses duplicate derived catalog keys instead of discarding source-derived history", () => {
    const directory = legacyDir("eaj-migration-catalog-conflict");
    try {
      makeLegacyDatabase(directory, `
        CREATE TABLE task_catalog_table (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, side TEXT NOT NULL,
          label_ciphertext TEXT NOT NULL, label_iv TEXT NOT NULL, label_hash TEXT NOT NULL,
          typical_cost INTEGER NOT NULL, weekday_mask INTEGER NOT NULL, use_count INTEGER NOT NULL, last_used TEXT NOT NULL
        );
        INSERT INTO task_catalog_table VALUES ('one', 'person', 'deposit', 'a', 'iv', 'same', 20, 127, 1, '2026-08-01');
        INSERT INTO task_catalog_table VALUES ('two', 'person', 'deposit', 'b', 'iv', 'same', 20, 127, 1, '2026-08-02');
      `);
      expect(() => migrateDatabase(directory)).toThrow("duplicate derived catalog rows");
      const sqlite = new Database(join(directory, "eaj.sqlite"), { readonly: true });
      expect(sqlite.query("SELECT COUNT(*) AS count FROM task_catalog_table").get()).toEqual({ count: 2 });
      sqlite.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
