import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

export const userTable = sqliteTable("user_table", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  kekSalt: text("kek_salt").notNull(),
  wrappedDek: text("wrapped_dek").notNull(),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  recoveryCodesHash: text("recovery_codes_hash"),
  timezone: text("timezone").notNull().default("UTC"),
  lat: real("lat"),
  lon: real("lon"),
  country: text("country").default("US"),
  // "C" | "F"; null means "infer from region on the client"
  temperatureUnit: text("temperature_unit"),
  onboardingCompleted: integer("onboarding_completed", { mode: "boolean" }).notNull().default(false),
  locationPrompted: integer("location_prompted", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
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
    openingBalance: real("opening_balance").notNull(),
    closingBalance: real("closing_balance"),
    phase: text("phase").notNull().default("plan"),
    feelRating: integer("feel_rating"),
    journalCiphertext: text("journal_ciphertext"),
    journalIv: text("journal_iv"),
    audioPath: text("audio_path"),
    audioIv: text("audio_iv"),
    weatherJson: text("weather_json"),
    isHoliday: integer("is_holiday", { mode: "boolean" }).notNull().default(false),
    qualitativeCiphertext: text("qualitative_ciphertext"),
    qualitativeIv: text("qualitative_iv"),
    compensateNoteCiphertext: text("compensate_note_ciphertext"),
    compensateNoteIv: text("compensate_note_iv"),
  },
  (t) => [uniqueIndex("day_user_date").on(t.userId, t.date)],
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
