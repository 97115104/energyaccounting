import { sql } from "drizzle-orm";
import { index, sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const userTable = sqliteTable("user_table", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  kekSalt: text("kek_salt").notNull(),
  wrappedDek: text("wrapped_dek").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  recoveryCodesHash: text("recovery_codes_hash"),
  // Preferred name or alias for greetings; null until the user sets one.
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("UTC"),
  lat: real("lat"),
  lon: real("lon"),
  country: text("country").default("US"),
  // "C" | "F"; null means "infer from region on the client"
  temperatureUnit: text("temperature_unit"),
  // "classic" | "humor" | "facts" | "mix"; null means "mix"
  greetingStyle: text("greeting_style"),
  onboardingCompleted: integer("onboarding_completed", { mode: "boolean" }).notNull().default(false),
  locationPrompted: integer("location_prompted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// One-time signup invites. Only the SHA-256 of the normalized code is stored;
// the plaintext lives solely in the operator's local invite-codes.md.
export const inviteCodeTable = sqliteTable("invite_code_table", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp" }),
  // Audit-only, deliberately no FK: the code is claimed atomically just before
  // its user row is inserted, so the referenced id may not exist yet.
  usedByUserId: text("used_by_user_id"),
});

export const sessionTable = sqliteTable("session_table", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  pendingTotp: integer("pending_totp", { mode: "boolean" }).notNull().default(false),
});

export const dayTable = sqliteTable(
  "day_table",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    openingBalance: real("opening_balance").notNull(),
    closingBalance: real("closing_balance"),
    phase: text("phase").notNull().default("plan"),
    feelRating: integer("feel_rating"),
    journalCiphertext: text("journal_ciphertext"),
    journalIv: text("journal_iv"),
    weatherJson: text("weather_json"),
    isHoliday: integer("is_holiday", { mode: "boolean" }).notNull().default(false),
    qualitativeCiphertext: text("qualitative_ciphertext"),
    qualitativeIv: text("qualitative_iv"),
    compensateNoteCiphertext: text("compensate_note_ciphertext"),
    compensateNoteIv: text("compensate_note_iv"),
  },
  (t) => [
    index("day_user_started_at").on(t.userId, t.startedAt),
    // SQLite's partial index is the final guard against concurrent starts.
    uniqueIndex("day_one_active_per_user")
      .on(t.userId)
      .where(sql`${t.phase} <> 'closed'`),
  ],
);

export const taskLineTable = sqliteTable("task_line_table", {
  id: text("id").primaryKey(),
  dayId: text("day_id")
    .notNull()
    .references(() => dayTable.id, { onDelete: "cascade" }),
  side: text("side").notNull(),
  sort: integer("sort").notNull().default(0),
  labelCiphertext: text("label_ciphertext").notNull(),
  labelIv: text("label_iv").notNull(),
  labelHash: text("label_hash").notNull().default(""),
  plannedCost: integer("planned_cost").notNull(),
  actualCost: integer("actual_cost"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  difficulty: integer("difficulty"),
  detailsCiphertext: text("details_ciphertext"),
  detailsIv: text("details_iv"),
});

export const taskCatalogTable = sqliteTable("task_catalog_table", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => userTable.id, { onDelete: "cascade" }),
  side: text("side").notNull(),
  labelCiphertext: text("label_ciphertext").notNull(),
  labelIv: text("label_iv").notNull(),
  labelHash: text("label_hash").notNull(),
  typicalCost: integer("typical_cost").notNull().default(20),
  weekdayMask: integer("weekday_mask").notNull().default(127),
  useCount: integer("use_count").notNull().default(1),
  difficultyTotal: integer("difficulty_total").notNull().default(0),
  difficultyCount: integer("difficulty_count").notNull().default(0),
  lastUsed: text("last_used").notNull(),
});

export const weatherCacheTable = sqliteTable(
  "weather_cache_table",
  {
    id: text("id").primaryKey(),
    latKey: text("lat_key").notNull(),
    lonKey: text("lon_key").notNull(),
    date: text("date").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [uniqueIndex("weather_loc_date").on(t.latKey, t.lonKey, t.date)],
);
