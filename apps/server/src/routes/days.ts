import {
  DAILY_ENERGY,
  attwoodTotals,
  availableCapacity,
  clampCost,
  clampDifficulty,
  closingBalance,
  completedFreedEnergy,
  foldCatalog,
  reservedCapacity,
  type CatalogOccurrence,
  type AllocatableTask,
  type TaskCosts,
} from "@eaj/shared";
import { and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/index.ts";
import { dayTable, taskCatalogTable, taskLineTable, userTable, youProfileTable } from "../db/schema.ts";
import { holidayForDate } from "../lib/holidays.ts";
import { sanitizeIdentity } from "../lib/identity.ts";
import { buildRestorePlan, type RestorePlanIndexes } from "../lib/restorePlan.ts";
import { assertIsoDate, newId, requireFullUser } from "../lib/session.ts";
import { fetchDayWeather, calendarDateInTimeZone, weatherNeedsRefresh } from "../lib/weather.ts";

function pairedDetails(
  ciphertext: string | null | undefined,
  iv: string | null | undefined,
): { ok: true; ciphertext: string | null; iv: string | null } | { ok: false } {
  if (ciphertext === undefined && iv === undefined) {
    return { ok: true, ciphertext: null, iv: null };
  }
  if (ciphertext === undefined || iv === undefined) return { ok: false };
  if ((ciphertext === null) !== (iv === null)) return { ok: false };
  if (ciphertext === null || iv === null) return { ok: true, ciphertext: null, iv: null };
  if (!ciphertext || !iv) return { ok: false };
  return { ok: true, ciphertext, iv };
}

async function ownedDay(userId: string, dayId: string) {
  return db.query.dayTable.findFirst({
    where: and(eq(dayTable.id, dayId), eq(dayTable.userId, userId)),
  });
}

type WriteDb = Pick<typeof db, "select" | "insert" | "update" | "delete">;

/** Ledgers strictly earlier than `day` in lifecycle order (startedAt, then id). */
function strictlyEarlierThan(day: typeof dayTable.$inferSelect) {
  return or(
    lt(dayTable.startedAt, day.startedAt),
    and(eq(dayTable.startedAt, day.startedAt), lt(dayTable.id, day.id)),
  );
}

/** Bound history scans so recent work stays a small ordered window. */
const PRIOR_LEDGER_WINDOW = 30;

async function priorClosedLedgers(day: typeof dayTable.$inferSelect) {
  return db
    .select()
    .from(dayTable)
    .where(
      and(
        eq(dayTable.userId, day.userId),
        eq(dayTable.phase, "closed"),
        strictlyEarlierThan(day),
      ),
    )
    .orderBy(desc(dayTable.startedAt), desc(dayTable.id))
    .limit(PRIOR_LEDGER_WINDOW);
}

async function linesForDay(dayId: string, executor: WriteDb = db) {
  return executor
    .select()
    .from(taskLineTable)
    .where(eq(taskLineTable.dayId, dayId))
    .orderBy(taskLineTable.sort);
}

/** Closed days accept amendments; keep the stored closing balance honest after each one. */
async function refreshClosedBalance(day: typeof dayTable.$inferSelect, executor: WriteDb = db) {
  if (day.phase !== "closed") return;
  const lines = await executor.select().from(taskLineTable).where(eq(taskLineTable.dayId, day.id));
  const tasks: TaskCosts[] = lines.map((l) => ({
    side: l.side as TaskCosts["side"],
    planned: l.plannedCost,
    actual: l.actualCost,
  }));
  await executor
    .update(dayTable)
    .set({ closingBalance: closingBalance(day.openingBalance, tasks) })
    .where(eq(dayTable.id, day.id));
}

/** Rebuild derived activity history after permanent day deletion. */
async function rebuildCatalog(userId: string, executor: WriteDb = db) {
  const days = await executor
    .select()
    .from(dayTable)
    .where(eq(dayTable.userId, userId))
    .orderBy(dayTable.startedAt, dayTable.id);
  const dayDates = new Map(days.map((day) => [day.id, day.date]));
  const lines = days.length
    ? await executor.select().from(taskLineTable).where(inArray(taskLineTable.dayId, days.map((day) => day.id)))
    : [];
  const occurrences: CatalogOccurrence[] = lines.flatMap((line) => {
    const date = dayDates.get(line.dayId);
    return date
      ? [{ date, line: { ...line, side: line.side as "deposit" | "withdrawal" } }]
      : [];
  });
  const entries = foldCatalog(occurrences);
  await executor.delete(taskCatalogTable).where(eq(taskCatalogTable.userId, userId));
  for (const entry of entries) {
    await executor.insert(taskCatalogTable).values({ id: newId(), userId, ...entry });
  }
}

/** Plaintext stat row for one day, shared by /stats and export. */
function statPointForDay(
  d: typeof dayTable.$inferSelect,
  lines: readonly (typeof taskLineTable.$inferSelect)[],
  includeLines: boolean,
) {
  const tasks: AllocatableTask[] = lines.map((l) => ({
    side: l.side as TaskCosts["side"],
    planned: l.plannedCost,
    actual: l.actualCost,
    completed: l.completed,
  }));
  const attwood = attwoodTotals(tasks);
  const plannedTotal = lines.reduce((a, l) => a + l.plannedCost, 0);
  const actualTotal = lines.reduce((a, l) => a + (l.actualCost ?? l.plannedCost), 0);
  const rated = lines.filter((l) => l.difficulty !== null);
  const pendingReservedEnergy = reservedCapacity(tasks);
  return {
    id: d.id,
    date: d.date,
    startedAt: d.startedAt.toISOString(),
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    durationMinutes: d.closedAt
      ? Math.max(0, Math.round((d.closedAt.getTime() - d.startedAt.getTime()) / 60_000))
      : null,
    openingBalance: d.openingBalance,
    closingBalance: d.closingBalance ?? closingBalance(d.openingBalance, tasks),
    attwoodNet: attwood.attwoodNet,
    depositTotal: attwood.depositTotal,
    withdrawalTotal: attwood.withdrawalTotal,
    isHoliday: d.isHoliday,
    weather: d.weatherJson ? JSON.parse(d.weatherJson) : null,
    feelRating: d.feelRating,
    phase: d.phase,
    taskCount: lines.length,
    completedCount: lines.filter((l) => l.completed).length,
    pendingReservedEnergy,
    completedFreedEnergy: completedFreedEnergy(tasks),
    availableCapacity: availableCapacity(d.openingBalance, tasks),
    avgDifficulty:
      rated.length > 0
        ? Math.round(
            (rated.reduce((sum, line) => sum + (line.difficulty ?? 0), 0) / rated.length) * 10,
          ) / 10
        : null,
    difficultyRatedCount: rated.length,
    plannedTotal,
    actualTotal,
    ...(includeLines
      ? {
          lines: lines.map((l) => ({
            side: l.side,
            sort: l.sort,
            labelCiphertext: l.labelCiphertext,
            labelIv: l.labelIv,
            labelHash: l.labelHash,
            plannedCost: l.plannedCost,
            actualCost: l.actualCost,
            completed: l.completed,
          })),
        }
      : {}),
  };
}

async function createDay(user: typeof userTable.$inferSelect, dateIso: string) {
  const hol = holidayForDate(dateIso, user.country ?? "US");
  let weather: Record<string, unknown> | null = null;
  if (user.lat != null && user.lon != null) {
    weather = await fetchDayWeather(user.lat, user.lon, dateIso);
  }
  const id = newId();
  const startedAt = new Date();
  await db.insert(dayTable).values({
    id,
    userId: user.id,
    date: dateIso,
    startedAt,
    openingBalance: DAILY_ENERGY,
    phase: "plan",
    isHoliday: hol.isHoliday,
    weatherJson: weather
      ? JSON.stringify({ ...weather, holidayName: hol.name })
      : JSON.stringify({ holidayName: hol.name }),
  });
  return (await db.query.dayTable.findFirst({ where: eq(dayTable.id, id) }))!;
}

/**
 * Keep an open day's weatherJson on the location's current calendar day so
 * quips/guide track this afternoon — not last night of an overnight-open day.
 */
async function upgradeOpenDayWeather(
  user: typeof userTable.$inferSelect,
  day: typeof dayTable.$inferSelect,
): Promise<typeof dayTable.$inferSelect> {
  if (day.phase === "closed") return day;
  if (user.lat == null || user.lon == null) return day;
  let existing: Record<string, unknown> = {};
  try {
    existing = day.weatherJson ? (JSON.parse(day.weatherJson) as Record<string, unknown>) : {};
  } catch {
    existing = {};
  }

  // Prefer Open-Meteo zone from a prior fetch; skip profile "UTC" defaults that
  // mis-date Pacific users near midnight.
  let zone =
    typeof existing.timezone === "string" && existing.timezone
      ? existing.timezone
      : user.timezone && user.timezone !== "UTC"
        ? user.timezone
        : null;

  if (!zone) {
    const probe = await fetchDayWeather(user.lat, user.lon, day.date);
    if (probe && typeof probe.timezone === "string" && probe.timezone) {
      zone = probe.timezone;
      existing = { ...existing, ...probe };
    } else {
      zone = "UTC";
    }
  }

  const todayLocal = calendarDateInTimeZone(new Date(), zone);
  if (!weatherNeedsRefresh(existing, todayLocal)) return day;

  const fresh = await fetchDayWeather(user.lat, user.lon, todayLocal);
  if (!fresh) return day;
  const holidayName =
    typeof existing.holidayName === "string"
      ? existing.holidayName
      : holidayForDate(day.date, user.country ?? "US").name;
  const weatherJson = JSON.stringify({ ...fresh, holidayName });
  await db.update(dayTable).set({ weatherJson }).where(eq(dayTable.id, day.id));
  return { ...day, weatherJson };
}

function serializeDay(
  day: typeof dayTable.$inferSelect,
  lines: (typeof taskLineTable.$inferSelect)[],
) {
  const tasks: AllocatableTask[] = lines.map((l) => ({
    side: l.side as TaskCosts["side"],
    planned: l.plannedCost,
    actual: l.actualCost,
    completed: l.completed,
  }));
  const attwood = attwoodTotals(tasks);
  const projected = closingBalance(day.openingBalance, tasks);
  return {
    id: day.id,
    // A corpus uses this stable key for idempotent restores. Existing rows
    // predate the column, so their local id is their stable source identity.
    sourceId: day.sourceId ?? day.id,
    date: day.date,
    startedAt: day.startedAt.toISOString(),
    closedAt: day.closedAt ? day.closedAt.toISOString() : null,
    durationMinutes: day.closedAt
      ? Math.max(0, Math.round((day.closedAt.getTime() - day.startedAt.getTime()) / 60_000))
      : null,
    openingBalance: day.openingBalance,
    closingBalance: day.closingBalance,
    projectedClosing: projected,
    availableCapacity: availableCapacity(day.openingBalance, tasks),
    phase: day.phase,
    feelRating: day.feelRating,
    journalCiphertext: day.journalCiphertext,
    journalIv: day.journalIv,
    weather: day.weatherJson ? JSON.parse(day.weatherJson) : null,
    isHoliday: day.isHoliday,
    qualitativeCiphertext: day.qualitativeCiphertext,
    qualitativeIv: day.qualitativeIv,
    compensateNoteCiphertext: day.compensateNoteCiphertext,
    compensateNoteIv: day.compensateNoteIv,
    attwood,
    lines: lines.map((l) => ({
      id: l.id,
      sourceId: l.sourceId ?? l.id,
      side: l.side,
      sort: l.sort,
      labelCiphertext: l.labelCiphertext,
      labelIv: l.labelIv,
      labelHash: l.labelHash,
      plannedCost: l.plannedCost,
      actualCost: l.actualCost,
      completed: l.completed,
      completedAt: l.completedAt ? l.completedAt.toISOString() : null,
      difficulty: l.difficulty,
      detailsCiphertext: l.detailsCiphertext,
      detailsIv: l.detailsIv,
    })),
  };
}

const restoreLineSchema = t.Object({
  sourceId: t.String({ minLength: 1, maxLength: 200 }),
  side: t.Union([t.Literal("deposit"), t.Literal("withdrawal")]),
  sort: t.Number(),
  labelCiphertext: t.String({ minLength: 1 }),
  labelIv: t.String({ minLength: 8 }),
  labelHash: t.String(),
  plannedCost: t.Number(),
  actualCost: t.Nullable(t.Number()),
  completed: t.Boolean(),
  completedAt: t.Nullable(t.String()),
  difficulty: t.Nullable(t.Number()),
  detailsCiphertext: t.Nullable(t.String()),
  detailsIv: t.Nullable(t.String()),
});

const restoreDaySchema = t.Object({
  sourceId: t.String({ minLength: 1, maxLength: 200 }),
  date: t.String(),
  startedAt: t.String(),
  closedAt: t.Nullable(t.String()),
  openingBalance: t.Number(),
  phase: t.Union([t.Literal("plan"), t.Literal("audit"), t.Literal("closed")]),
  feelRating: t.Nullable(t.Number()),
  weather: t.Nullable(t.Record(t.String(), t.Unknown())),
  isHoliday: t.Boolean(),
  journalCiphertext: t.Nullable(t.String()),
  journalIv: t.Nullable(t.String()),
  compensateNoteCiphertext: t.Nullable(t.String()),
  compensateNoteIv: t.Nullable(t.String()),
  // This field is retired from the interface and its historical AAD is not
  // recoverable. Keep its opaque bytes for same-key archival restores.
  legacyQualitative: t.Nullable(
    t.Object({ ciphertext: t.String({ minLength: 1 }), iv: t.String({ minLength: 8 }) }),
  ),
  lines: t.Array(restoreLineSchema),
});

const restoreUserSchema = t.Object({
  displayName: t.Nullable(t.String({ maxLength: 80 })),
  timezone: t.String(),
  lat: t.Nullable(t.Number()),
  lon: t.Nullable(t.Number()),
  country: t.Nullable(t.String()),
  temperatureUnit: t.Union([t.Literal("C"), t.Literal("F"), t.Null()]),
  greetingStyle: t.Union([
    t.Literal("classic"),
    t.Literal("humor"),
    t.Literal("facts"),
    t.Literal("mix"),
    t.Null(),
  ]),
  includePhysicalActivities: t.Boolean(),
  revealSuggestionsWhenEmpty: t.Boolean(),
  onboardingCompleted: t.Boolean(),
  locationPrompted: t.Boolean(),
  identity: t.Union([t.Record(t.String(), t.Unknown()), t.Null()]),
});

const restoreCorpusSchema = t.Object({
  schemaVersion: t.Literal(7),
  mode: t.Union([t.Literal("merge"), t.Literal("replace")]),
  activeDayResolution: t.Optional(
    t.Union([t.Literal("keep-current"), t.Literal("replace-current")]),
  ),
  user: restoreUserSchema,
  youProfile: t.Nullable(
    t.Object({
      ciphertext: t.String({ minLength: 1 }),
      iv: t.String({ minLength: 8 }),
      updatedAt: t.String(),
    }),
  ),
  days: t.Array(restoreDaySchema),
});

const restorePreviewSchema = t.Object({
  days: t.Array(
    t.Object({
      sourceId: t.String({ minLength: 1, maxLength: 200 }),
      phase: t.Union([t.Literal("plan"), t.Literal("audit"), t.Literal("closed")]),
      lineSourceIds: t.Array(t.String({ minLength: 1, maxLength: 200 })),
    }),
  ),
  hasProfile: t.Boolean(),
});

type RestoreCorpus = typeof restoreCorpusSchema.static;
type RestoreDay = typeof restoreDaySchema.static;

function restoreTimestamp(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be an ISO timestamp.`);
  return date;
}

function restorePairsAreValid(day: RestoreDay): boolean {
  const pairs: Array<[string | null, string | null]> = [
    [day.journalCiphertext, day.journalIv],
    [day.compensateNoteCiphertext, day.compensateNoteIv],
  ];
  for (const line of day.lines) pairs.push([line.detailsCiphertext, line.detailsIv]);
  return pairs.every(([ciphertext, iv]) => (ciphertext === null) === (iv === null));
}

function validateRestoreCorpus(corpus: RestoreCorpus): string | null {
  if (corpus.youProfile) {
    if (corpus.youProfile.ciphertext.length > 256 * 1024) {
      return "Profile is too large to save.";
    }
    if (corpus.youProfile.iv.length > 64) return "Invalid encryption IV.";
    try {
      restoreTimestamp(corpus.youProfile.updatedAt, "You profile update");
    } catch (e) {
      return e instanceof Error ? e.message : "The You profile timestamp is invalid.";
    }
  }
  const sourceDays = new Set<string>();
  let openDays = 0;
  for (const day of corpus.days) {
    if (!day.sourceId.trim() || sourceDays.has(day.sourceId)) return "Each imported day needs a unique source id.";
    sourceDays.add(day.sourceId);
    if (!restorePairsAreValid(day)) return "Encrypted journal fields need both ciphertext and IV, or neither.";
    try {
      assertIsoDate(day.date);
      restoreTimestamp(day.startedAt, "Day start");
      if (day.closedAt) restoreTimestamp(day.closedAt, "Day close");
      for (const line of day.lines) {
        if (line.completedAt) restoreTimestamp(line.completedAt, "Task completion");
        if (!Number.isFinite(line.plannedCost) || !Number.isFinite(line.sort)) {
          return "Imported task costs and sort order must be finite numbers.";
        }
      }
    } catch (e) {
      return e instanceof Error ? e.message : "The corpus contains an invalid date.";
    }
    const sourceLines = new Set<string>();
    for (const line of day.lines) {
      if (!line.sourceId.trim() || sourceLines.has(line.sourceId)) {
        return "Each imported task needs a unique source id within its day.";
      }
      sourceLines.add(line.sourceId);
    }
    if (day.phase !== "closed") openDays += 1;
  }
  if (openDays > 1) return "A corpus may contain only one active energy day.";
  return null;
}

async function restorePlanIndexes(userId: string, executor: WriteDb = db): Promise<RestorePlanIndexes> {
  const days = await executor.select().from(dayTable).where(eq(dayTable.userId, userId));
  const dayIdBySource = new Map<string, string>();
  for (const day of days) {
    dayIdBySource.set(day.id, day.id);
    if (day.sourceId) dayIdBySource.set(day.sourceId, day.id);
  }
  const lines = days.length
    ? await executor.select().from(taskLineTable).where(inArray(taskLineTable.dayId, days.map((day) => day.id)))
    : [];
  const lineSourcesByDay = new Map<string, Set<string>>();
  for (const line of lines) {
    const sources = lineSourcesByDay.get(line.dayId) ?? new Set<string>();
    sources.add(line.id);
    if (line.sourceId) sources.add(line.sourceId);
    lineSourcesByDay.set(line.dayId, sources);
  }
  const active = days.find((day) => day.phase !== "closed");
  return {
    dayIdBySource,
    lineSourcesByDay,
    activeDayId: active?.id ?? null,
    activeDaySourceId: active ? active.sourceId ?? active.id : null,
  };
}

async function restorePreview(userId: string, preview: typeof restorePreviewSchema.static) {
  const plan = buildRestorePlan(
    preview.days.map((day) => ({
      sourceId: day.sourceId,
      phase: day.phase,
      lines: day.lineSourceIds.map((sourceId) => ({ sourceId })),
    })),
    await restorePlanIndexes(userId),
  );
  return {
    daysToAdd: plan.daysToAdd,
    daysExisting: plan.daysExisting,
    linesToAdd: plan.linesToAdd,
    linesExisting: plan.linesExisting,
    hasImportedProfile: preview.hasProfile,
    activeDayConflict: plan.activeDayConflict,
    currentActiveSourceId: plan.currentActiveSourceId,
    importedActiveSourceId: plan.importedActiveSourceId,
  };
}

function importedProfilePatch(userId: string, user: RestoreCorpus["user"]) {
  const identity = user.identity === null ? null : sanitizeIdentity(user.identity, userId);
  if (user.identity !== null && !identity) throw new Error("Identity config is invalid.");
  const identityJson = identity ? JSON.stringify(identity) : null;
  if (identityJson && identityJson.length > 4 * 1024) throw new Error("Identity config is too large.");
  return {
    displayName: user.displayName?.trim() || null,
    timezone: user.timezone,
    lat: user.lat,
    lon: user.lon,
    country: user.country,
    temperatureUnit: user.temperatureUnit,
    greetingStyle: user.greetingStyle,
    includePhysicalActivities: user.includePhysicalActivities,
    revealSuggestionsWhenEmpty: user.revealSuggestionsWhenEmpty,
    onboardingCompleted: user.onboardingCompleted,
    locationPrompted: user.locationPrompted,
    identityJson,
  };
}

function restoredLineValues(line: RestoreDay["lines"][number], dayId: string) {
  return {
    id: newId(),
    sourceId: line.sourceId,
    dayId,
    side: line.side,
    sort: Math.trunc(line.sort),
    labelCiphertext: line.labelCiphertext,
    labelIv: line.labelIv,
    labelHash: line.labelHash,
    plannedCost: clampCost(line.plannedCost),
    actualCost: line.actualCost === null ? null : clampCost(line.actualCost),
    completed: line.completed,
    completedAt: line.completedAt ? restoreTimestamp(line.completedAt, "Task completion") : null,
    difficulty: line.difficulty === null ? null : clampDifficulty(line.difficulty),
    detailsCiphertext: line.detailsCiphertext,
    detailsIv: line.detailsIv,
  };
}

async function insertRestoredDay(
  userId: string,
  source: RestoreDay,
  executor: WriteDb,
): Promise<typeof dayTable.$inferSelect> {
  const id = newId();
  const startedAt = restoreTimestamp(source.startedAt, "Day start");
  const closedAt = source.closedAt
    ? restoreTimestamp(source.closedAt, "Day close")
    : source.phase === "closed"
      ? startedAt
      : null;
  const lines = source.lines.map((line) => restoredLineValues(line, id));
  const tasks: TaskCosts[] = lines.map((line) => ({
    side: line.side,
    planned: line.plannedCost,
    actual: line.actualCost,
  }));
  await executor.insert(dayTable).values({
    id,
    sourceId: source.sourceId,
    userId,
    date: assertIsoDate(source.date),
    startedAt,
    closedAt,
    openingBalance: source.openingBalance,
    closingBalance: source.phase === "closed" ? closingBalance(source.openingBalance, tasks) : null,
    phase: source.phase,
    feelRating: source.feelRating,
    journalCiphertext: source.journalCiphertext,
    journalIv: source.journalIv,
    weatherJson: source.weather ? JSON.stringify(source.weather) : null,
    isHoliday: source.isHoliday,
    qualitativeCiphertext: source.legacyQualitative?.ciphertext ?? null,
    qualitativeIv: source.legacyQualitative?.iv ?? null,
    compensateNoteCiphertext: source.compensateNoteCiphertext,
    compensateNoteIv: source.compensateNoteIv,
  });
  if (lines.length > 0) await executor.insert(taskLineTable).values(lines);
  return (await executor.select().from(dayTable).where(eq(dayTable.id, id)))[0]!;
}

export const dayRoutes = new Elysia({ prefix: "/api" })
  .get("/days/active", async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let day = await db.query.dayTable.findFirst({
      where: and(eq(dayTable.userId, user.id), ne(dayTable.phase, "closed")),
      orderBy: [desc(dayTable.startedAt), desc(dayTable.id)],
    });
    if (!day) return { day: null };
    if (day.openingBalance !== DAILY_ENERGY) {
      // This also repairs an active row created by an older process during rollout.
      await db
        .update(dayTable)
        .set({ openingBalance: DAILY_ENERGY })
        .where(eq(dayTable.id, day.id));
      day.openingBalance = DAILY_ENERGY;
    }
    day = await upgradeOpenDayWeather(user, day);
    const lines = await linesForDay(day.id);
    return { day: serializeDay(day, lines) };
  })
  .post(
    "/days/start",
    async ({ body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      let date: string;
      try {
        date = assertIsoDate(body.date);
      } catch {
        set.status = 400;
        return { error: "Invalid date." };
      }
      const active = await db.query.dayTable.findFirst({
        where: and(eq(dayTable.userId, user.id), ne(dayTable.phase, "closed")),
      });
      if (active) {
        set.status = 409;
        return { error: "An energy day is already active.", dayId: active.id };
      }
      try {
        const day = await createDay(user, date);
        set.status = 201;
        return serializeDay(day, []);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("day_one_active_per_user") || message.includes("UNIQUE constraint")) {
          set.status = 409;
          return { error: "An energy day is already active." };
        }
        throw e;
      }
    },
    {
      body: t.Object({ date: t.String() }),
    },
  )
  .get(
    "/days",
    async ({ query, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const rows = await db
        .select()
        .from(dayTable)
        .where(
          and(
            eq(dayTable.userId, user.id),
            query.from ? gte(dayTable.date, query.from) : undefined,
            query.to ? lte(dayTable.date, query.to) : undefined,
          ),
        )
        .orderBy(dayTable.startedAt, dayTable.id);
      return {
        days: rows.map((d) => ({
          id: d.id,
          date: d.date,
          startedAt: d.startedAt.toISOString(),
          closedAt: d.closedAt ? d.closedAt.toISOString() : null,
          durationMinutes: d.closedAt
            ? Math.max(0, Math.round((d.closedAt.getTime() - d.startedAt.getTime()) / 60_000))
            : null,
          openingBalance: d.openingBalance,
          closingBalance: d.closingBalance,
          phase: d.phase,
          feelRating: d.feelRating,
          isHoliday: d.isHoliday,
          weather: d.weatherJson ? JSON.parse(d.weatherJson) : null,
        })),
      };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    },
  )
  .get("/days/:dayId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    day = await upgradeOpenDayWeather(user, day);
    return await serializeDay(day, await linesForDay(day.id));
  })
  .get("/export/days", async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const days = await db
      .select()
      .from(dayTable)
      .where(eq(dayTable.userId, user.id))
      .orderBy(dayTable.startedAt, dayTable.id);
    const out = [];
    for (const d of days) {
      const lines = await db
        .select()
        .from(taskLineTable)
        .where(eq(taskLineTable.dayId, d.id))
        .orderBy(taskLineTable.sort);
      out.push(serializeDay(d, lines));
    }
    const catalog = await db
      .select()
      .from(taskCatalogTable)
      .where(eq(taskCatalogTable.userId, user.id));
    let identity: unknown = null;
    if (user.identityJson) {
      try {
        identity = JSON.parse(user.identityJson) as unknown;
      } catch {
        identity = null;
      }
    }
    return {
      schemaVersion: 7,
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        displayName: user.displayName,
        timezone: user.timezone,
        lat: user.lat,
        lon: user.lon,
        country: user.country,
        temperatureUnit: user.temperatureUnit,
        greetingStyle: user.greetingStyle,
        includePhysicalActivities: user.includePhysicalActivities,
        revealSuggestionsWhenEmpty: user.revealSuggestionsWhenEmpty,
        onboardingCompleted: user.onboardingCompleted,
        locationPrompted: user.locationPrompted,
        identity,
      },
      days: out,
      catalog: catalog.map((c) => ({
        id: c.id,
        side: c.side,
        labelCiphertext: c.labelCiphertext,
        labelIv: c.labelIv,
        labelHash: c.labelHash,
        typicalCost: c.typicalCost,
        weekdayMask: c.weekdayMask,
        useCount: c.useCount,
        typicalDifficulty:
          c.difficultyCount > 0 ? Math.round((c.difficultyTotal / c.difficultyCount) * 10) / 10 : null,
        difficultyCount: c.difficultyCount,
        lastUsed: c.lastUsed,
      })),
    };
  })
  .post(
    "/import/corpus/preview",
    async ({ body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const dayIds = new Set<string>();
      for (const day of body.days) {
        if (dayIds.has(day.sourceId)) {
          set.status = 400;
          return { error: "Each imported day needs a unique source id." };
        }
        dayIds.add(day.sourceId);
        if (new Set(day.lineSourceIds).size !== day.lineSourceIds.length) {
          set.status = 400;
          return { error: "Each imported task needs a unique source id within its day." };
        }
      }
      return await restorePreview(user.id, body);
    },
    { body: restorePreviewSchema },
  )
  .post(
    "/import/corpus",
    async ({ body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const invalid = validateRestoreCorpus(body);
      if (invalid) {
        set.status = 400;
        return { error: invalid };
      }
      let profilePatch: ReturnType<typeof importedProfilePatch> | null = null;
      if (body.mode === "replace") {
        try {
          profilePatch = importedProfilePatch(user.id, body.user);
        } catch (e) {
          set.status = 400;
          return { error: e instanceof Error ? e.message : "Imported profile is invalid." };
        }
      }
      const before = await restorePreview(user.id, {
        days: body.days.map((day) => ({
          sourceId: day.sourceId,
          phase: day.phase,
          lineSourceIds: day.lines.map((line) => line.sourceId),
        })),
        hasProfile: body.youProfile !== null,
      });
      if (body.mode === "merge" && before.activeDayConflict && !body.activeDayResolution) {
        set.status = 409;
        return { error: "Choose how to resolve the active energy day.", ...before };
      }

      const restored = {
        daysAdded: 0,
        daysExisting: 0,
        daysSkippedForActiveConflict: 0,
        linesAdded: 0,
        linesExisting: 0,
      };
      try {
        await db.transaction(async (tx) => {
          if (body.mode === "replace") {
            await tx.delete(dayTable).where(eq(dayTable.userId, user.id));
            await tx.delete(taskCatalogTable).where(eq(taskCatalogTable.userId, user.id));
            await tx.delete(youProfileTable).where(eq(youProfileTable.userId, user.id));
            await tx.update(userTable).set(profilePatch!).where(eq(userTable.id, user.id));
          }

          // Build the whole ID-only diff from two bulk reads, then execute the
          // deterministic plan in this same transaction. This avoids N+1
          // restore lookups and makes repeat merges explicitly idempotent.
          const currentDays = await tx.select().from(dayTable).where(eq(dayTable.userId, user.id));
          const currentLines = currentDays.length
            ? await tx.select().from(taskLineTable).where(inArray(taskLineTable.dayId, currentDays.map((day) => day.id)))
            : [];
          const dayIdBySource = new Map<string, string>();
          const dayById = new Map(currentDays.map((day) => [day.id, day]));
          for (const day of currentDays) {
            dayIdBySource.set(day.id, day.id);
            if (day.sourceId) dayIdBySource.set(day.sourceId, day.id);
          }
          const lineSourcesByDay = new Map<string, Set<string>>();
          const lineByDayAndSource = new Map<string, typeof taskLineTable.$inferSelect>();
          for (const line of currentLines) {
            const sources = lineSourcesByDay.get(line.dayId) ?? new Set<string>();
            sources.add(line.id);
            lineByDayAndSource.set(`${line.dayId}:${line.id}`, line);
            if (line.sourceId) {
              sources.add(line.sourceId);
              lineByDayAndSource.set(`${line.dayId}:${line.sourceId}`, line);
            }
            lineSourcesByDay.set(line.dayId, sources);
          }
          let active = currentDays.find((day) => day.phase !== "closed");
          const plan = buildRestorePlan(
            body.days.map((day) => ({
              sourceId: day.sourceId,
              phase: day.phase,
              lines: day.lines.map((line) => ({ sourceId: line.sourceId })),
            })),
            {
              dayIdBySource,
              lineSourcesByDay,
              activeDayId: active?.id ?? null,
              activeDaySourceId: active ? active.sourceId ?? active.id : null,
            },
            body.activeDayResolution,
          );
          if (plan.activeDayConflict && !body.activeDayResolution) {
            throw new Error("Choose how to resolve the active energy day.");
          }
          const sourceDays = new Map(body.days.map((day) => [day.sourceId, day]));
          for (const action of plan.days) {
            const sourceDay = sourceDays.get(action.sourceId)!;
            if (action.action === "skip-active-conflict") {
              restored.daysSkippedForActiveConflict += 1;
              continue;
            }
            if (action.action === "insert") {
              if (sourceDay.phase !== "closed" && active) {
                if (body.activeDayResolution !== "replace-current") {
                  throw new Error("Choose how to resolve the active energy day.");
                }
                await tx.delete(dayTable).where(eq(dayTable.id, active.id));
                active = undefined;
              }
              const inserted = await insertRestoredDay(user.id, sourceDay, tx);
              restored.daysAdded += 1;
              restored.linesAdded += sourceDay.lines.length;
              if (inserted.phase !== "closed") active = inserted;
              continue;
            }

            const target = dayById.get(action.targetDayId!);
            if (!target) throw new Error("The account changed while the restore was in progress. Review and try again.");
            restored.daysExisting += 1;
            if (!target.sourceId) {
              await tx.update(dayTable).set({ sourceId: sourceDay.sourceId }).where(eq(dayTable.id, target.id));
            }
            const sourceLines = new Map(sourceDay.lines.map((line) => [line.sourceId, line]));
            for (const sourceId of action.lineSourceIdsExisting) {
              const existingLine = lineByDayAndSource.get(`${target.id}:${sourceId}`);
              if (!existingLine) throw new Error("The account changed while the restore was in progress. Review and try again.");
              restored.linesExisting += 1;
              if (!existingLine.sourceId) {
                await tx.update(taskLineTable).set({ sourceId }).where(eq(taskLineTable.id, existingLine.id));
              }
            }
            for (const sourceId of action.lineSourceIdsToInsert) {
              const sourceLine = sourceLines.get(sourceId)!;
              await tx.insert(taskLineTable).values(restoredLineValues(sourceLine, target.id));
              restored.linesAdded += 1;
            }
            if (action.lineSourceIdsToInsert.length > 0) await refreshClosedBalance(target, tx);
          }

          if (body.mode === "replace" && body.youProfile) {
            await tx.insert(youProfileTable).values({
              userId: user.id,
              ciphertext: body.youProfile.ciphertext,
              iv: body.youProfile.iv,
              updatedAt: restoreTimestamp(body.youProfile.updatedAt, "You profile update"),
            });
          }
          await rebuildCatalog(user.id, tx);
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("day_one_active_per_user") || message.includes("UNIQUE constraint")) {
          set.status = 409;
          return { error: "The account changed while the restore was in progress. Review and try again." };
        }
        throw e;
      }
      return { ok: true, profileRestored: body.mode === "replace", ...restored };
    },
    { body: restoreCorpusSchema },
  )
  .post(
    "/days/:dayId/lines",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const day = await ownedDay(user.id, params.dayId);
      if (!day) {
        set.status = 404;
        return { error: "Day not found." };
      }
      const planned = clampCost(body.plannedCost);
      const actual =
        body.actualCost === undefined || body.actualCost === null
          ? null
          : clampCost(body.actualCost);
      const difficulty = clampDifficulty(body.difficulty);
      const existing = await db
        .select()
        .from(taskLineTable)
        .where(eq(taskLineTable.dayId, day.id));
      const allocatable: AllocatableTask[] = existing.map((l) => ({
        side: l.side as TaskCosts["side"],
        planned: l.plannedCost,
        actual: l.actualCost,
        completed: l.completed,
      }));
      // Amendments to a closed day record what actually happened, so the
      // live capacity guard does not apply to them. Deposits restore energy
      // and never compete for the finite use-energy supply.
      const avail = availableCapacity(day.openingBalance, allocatable);
      if (
        day.phase !== "closed" &&
        body.side === "withdrawal" &&
        planned > avail &&
        body.allowOverCapacity !== true
      ) {
        set.status = 400;
        return {
          error: `That uses ${planned} points, and only ${avail} remain available to allocate.`,
        };
      }
      const details = pairedDetails(body.detailsCiphertext, body.detailsIv);
      if (!details.ok) {
        set.status = 400;
        return { error: "Task notes need both ciphertext and IV, or neither." };
      }
      const id = newId();
      const newLine = {
        id,
        dayId: day.id,
        side: body.side,
        sort: existing.length,
        labelCiphertext: body.labelCiphertext,
        labelIv: body.labelIv,
        labelHash: body.labelHash,
        plannedCost: planned,
        actualCost: actual,
        completed: false,
        completedAt: null,
        difficulty,
        detailsCiphertext: details.ciphertext,
        detailsIv: details.iv,
      };
      // Source and derived catalog state are one command: a failed catalog
      // write can never leave a successfully-created task behind.
      await db.transaction(async (tx) => {
        await tx.insert(taskLineTable).values(newLine);
        await rebuildCatalog(user.id, tx);
        await refreshClosedBalance(day, tx);
      });
      return { id };
    },
    {
      body: t.Object({
        side: t.Union([t.Literal("deposit"), t.Literal("withdrawal")]),
        labelCiphertext: t.String(),
        labelIv: t.String(),
        labelHash: t.String(),
        plannedCost: t.Number(),
        actualCost: t.Optional(t.Nullable(t.Number())),
        difficulty: t.Optional(t.Nullable(t.Number())),
        detailsCiphertext: t.Optional(t.Nullable(t.String())),
        detailsIv: t.Optional(t.Nullable(t.String())),
        allowOverCapacity: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/days/:dayId/lines/reorder",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const day = await ownedDay(user.id, params.dayId);
      if (!day) {
        set.status = 404;
        return { error: "Day not found." };
      }
      const ids = body.positions.map((position) => position.id);
      if (new Set(ids).size !== ids.length) {
        set.status = 400;
        return { error: "Each task can appear only once in a reorder." };
      }
      const existing = await db
        .select()
        .from(taskLineTable)
        .where(eq(taskLineTable.dayId, day.id));
      const existingById = new Map(existing.map((line) => [line.id, line]));
      if (ids.some((id) => !existingById.has(id))) {
        set.status = 404;
        return { error: "One or more tasks no longer belong to this day." };
      }
      await db.transaction(async (tx) => {
        for (const position of body.positions) {
          await tx
            .update(taskLineTable)
            .set({ side: position.side, sort: Math.max(0, Math.round(position.sort)) })
            .where(and(eq(taskLineTable.id, position.id), eq(taskLineTable.dayId, day.id)));
        }
        await rebuildCatalog(user.id, tx);
        await refreshClosedBalance(day, tx);
      });
      return { ok: true };
    },
    {
      body: t.Object({
        positions: t.Array(
          t.Object({
            id: t.String(),
            side: t.Union([t.Literal("deposit"), t.Literal("withdrawal")]),
            sort: t.Number(),
          }),
        ),
      }),
    },
  )
  .patch(
    "/days/:dayId/lines/:lineId",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const day = await ownedDay(user.id, params.dayId);
      if (!day) {
        set.status = 404;
        return { error: "Day not found." };
      }
      const line = await db.query.taskLineTable.findFirst({
        where: and(eq(taskLineTable.id, params.lineId), eq(taskLineTable.dayId, day.id)),
      });
      if (!line) {
        set.status = 404;
        return { error: "Line not found." };
      }

      const nextCompleted = body.completed === undefined ? line.completed : body.completed;
      let nextCompletedAt = line.completedAt;
      if (body.completed === true && (!line.completed || line.completedAt === null)) {
        nextCompletedAt = new Date();
      } else if (body.completed === false) {
        nextCompletedAt = null;
      }
      let nextActual =
        body.actualCost === undefined
          ? line.actualCost
          : body.actualCost === null
            ? null
            : clampCost(body.actualCost);
      if (body.completed === true && nextActual === null) {
        nextActual = line.plannedCost;
      }
      const nextPlanned =
        body.plannedCost === undefined ? line.plannedCost : clampCost(body.plannedCost);
      const nextDifficulty =
        body.difficulty === undefined ? line.difficulty : clampDifficulty(body.difficulty);
      const nextSide = body.side ?? line.side;
      // labelHash is a client correlation handle; only accept a new one with a full label rewrite.
      const rewritingLabel =
        body.labelCiphertext !== undefined ||
        body.labelIv !== undefined ||
        body.labelHash !== undefined;
      if (rewritingLabel) {
        if (!body.labelCiphertext || !body.labelIv || !body.labelHash) {
          set.status = 400;
          return { error: "Relabeling needs ciphertext, IV, and labelHash together." };
        }
      }
      const nextLabelHash = body.labelHash ?? line.labelHash;
      const detailsTouched =
        body.detailsCiphertext !== undefined || body.detailsIv !== undefined;
      let nextDetailsCiphertext = line.detailsCiphertext;
      let nextDetailsIv = line.detailsIv;
      if (detailsTouched) {
        const details = pairedDetails(body.detailsCiphertext, body.detailsIv);
        if (!details.ok) {
          set.status = 400;
          return { error: "Task notes need both ciphertext and IV, or neither." };
        }
        nextDetailsCiphertext = details.ciphertext;
        nextDetailsIv = details.iv;
      }

      // Re-check capacity when reserved cost rises (higher planned, or un-complete).
      const siblings = await db
        .select()
        .from(taskLineTable)
        .where(eq(taskLineTable.dayId, day.id));
      const currentReserved = reservedCapacity(
        siblings.map((l) => ({
          side: l.side as TaskCosts["side"],
          planned: l.plannedCost,
          actual: l.actualCost,
          completed: l.completed,
        })),
      );
      const projected: AllocatableTask[] = siblings.map((l) => {
        if (l.id !== line.id) {
          return {
            side: l.side as TaskCosts["side"],
            planned: l.plannedCost,
            actual: l.actualCost,
            completed: l.completed,
          };
        }
        return {
          side: nextSide as TaskCosts["side"],
          planned: nextPlanned,
          actual: nextActual,
          completed: nextCompleted,
        };
      });
      const nextReserved = reservedCapacity(projected);
      if (
        day.phase !== "closed" &&
        nextReserved > day.openingBalance &&
        nextReserved > currentReserved &&
        body.allowOverCapacity !== true
      ) {
        set.status = 400;
        return { error: "That change would reserve more points than remain available." };
      }

      const changes = {
        plannedCost: nextPlanned,
        actualCost: nextActual,
        labelCiphertext: body.labelCiphertext ?? line.labelCiphertext,
        labelIv: body.labelIv ?? line.labelIv,
        labelHash: nextLabelHash,
        completed: nextCompleted,
        completedAt: nextCompletedAt,
        difficulty: nextDifficulty,
        detailsCiphertext: nextDetailsCiphertext,
        detailsIv: nextDetailsIv,
        side: nextSide,
        sort: body.sort === undefined ? line.sort : body.sort,
      };
      await db.transaction(async (tx) => {
        await tx.update(taskLineTable).set(changes).where(eq(taskLineTable.id, line.id));
        await rebuildCatalog(user.id, tx);
        await refreshClosedBalance(day, tx);
      });
      return { ok: true };
    },
    {
      body: t.Object({
        plannedCost: t.Optional(t.Number()),
        actualCost: t.Optional(t.Nullable(t.Number())),
        labelCiphertext: t.Optional(t.String()),
        labelIv: t.Optional(t.String()),
        labelHash: t.Optional(t.String()),
        completed: t.Optional(t.Boolean()),
        difficulty: t.Optional(t.Nullable(t.Number())),
        detailsCiphertext: t.Optional(t.Nullable(t.String())),
        detailsIv: t.Optional(t.Nullable(t.String())),
        side: t.Optional(t.Union([t.Literal("deposit"), t.Literal("withdrawal")])),
        sort: t.Optional(t.Number()),
        allowOverCapacity: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete("/days/:dayId/lines/:lineId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    const line = await db.query.taskLineTable.findFirst({
      where: and(eq(taskLineTable.id, params.lineId), eq(taskLineTable.dayId, day.id)),
    });
    if (!line) {
      set.status = 404;
      return { error: "Line not found." };
    }
    await db.transaction(async (tx) => {
      await tx
        .delete(taskLineTable)
        .where(and(eq(taskLineTable.id, params.lineId), eq(taskLineTable.dayId, day.id)));
      await rebuildCatalog(user.id, tx);
      await refreshClosedBalance(day, tx);
    });
    return { ok: true };
  })
  .delete("/days/:dayId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    if (day.phase !== "closed") {
      set.status = 400;
      return { error: "Only a closed day can be deleted from Previous days." };
    }
    // One write transaction keeps deletion and its derived activity history atomic.
    await db.transaction(async (tx) => {
      await tx.delete(dayTable).where(eq(dayTable.id, day.id));
      await rebuildCatalog(user.id, tx);
    });
    return { ok: true };
  })
  .patch(
    "/days/:dayId",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const day = await ownedDay(user.id, params.dayId);
      if (!day) {
        set.status = 404;
        return { error: "Day not found." };
      }
      // A closed day accepts amendments to its reflections but never
      // returns to the plan/audit lifecycle: one active day at a time.
      if (day.phase === "closed" && body.phase !== undefined) {
        set.status = 400;
        return { error: "A closed day cannot be reopened." };
      }
      await db
        .update(dayTable)
        .set({
          phase: body.phase ?? day.phase,
          feelRating: body.feelRating === undefined ? day.feelRating : body.feelRating,
          journalCiphertext:
            body.journalCiphertext === undefined ? day.journalCiphertext : body.journalCiphertext,
          journalIv: body.journalIv === undefined ? day.journalIv : body.journalIv,
          qualitativeCiphertext:
            body.qualitativeCiphertext === undefined
              ? day.qualitativeCiphertext
              : body.qualitativeCiphertext,
          qualitativeIv:
            body.qualitativeIv === undefined ? day.qualitativeIv : body.qualitativeIv,
          compensateNoteCiphertext:
            body.compensateNoteCiphertext === undefined
              ? day.compensateNoteCiphertext
              : body.compensateNoteCiphertext,
          compensateNoteIv:
            body.compensateNoteIv === undefined ? day.compensateNoteIv : body.compensateNoteIv,
        })
        .where(eq(dayTable.id, day.id));
      return { ok: true };
    },
    {
      body: t.Object({
        phase: t.Optional(t.Union([t.Literal("plan"), t.Literal("audit")])),
        feelRating: t.Optional(t.Nullable(t.Number())),
        journalCiphertext: t.Optional(t.Nullable(t.String())),
        journalIv: t.Optional(t.Nullable(t.String())),
        qualitativeCiphertext: t.Optional(t.Nullable(t.String())),
        qualitativeIv: t.Optional(t.Nullable(t.String())),
        compensateNoteCiphertext: t.Optional(t.Nullable(t.String())),
        compensateNoteIv: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .post("/days/:dayId/close", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    if (day.phase === "closed") {
      set.status = 400;
      return { error: "Day is already closed." };
    }
    const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, day.id));
    const tasks: TaskCosts[] = lines.map((l) => ({
      side: l.side as TaskCosts["side"],
      planned: l.plannedCost,
      actual: l.actualCost,
    }));
    const opening = DAILY_ENERGY;
    const closing = closingBalance(opening, tasks);
    const closedAt = new Date();
    await db
      .update(dayTable)
      .set({ phase: "closed", closedAt, openingBalance: opening, closingBalance: closing })
      .where(eq(dayTable.id, day.id));
    return {
      closingBalance: closing,
      openingBalance: opening,
      closedAt: closedAt.toISOString(),
      attwood: attwoodTotals(tasks),
    };
  })
  .get("/suggestions/:dayId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, day.id));
    const existingHashes = new Set(lines.map((l) => l.labelHash).filter(Boolean));
    const catalog = await db
      .select()
      .from(taskCatalogTable)
      .where(eq(taskCatalogTable.userId, user.id))
      .orderBy(desc(taskCatalogTable.useCount));
    const suggestions = catalog
      .filter((c) => c.useCount >= 3)
      .filter((c) => !existingHashes.has(c.labelHash))
      .slice(0, 12)
      .map((c) => ({
        id: c.id,
        side: c.side,
        labelCiphertext: c.labelCiphertext,
        labelIv: c.labelIv,
        labelHash: c.labelHash,
        typicalCost: c.typicalCost,
        weekdayMask: c.weekdayMask,
        useCount: c.useCount,
        typicalDifficulty:
          c.difficultyCount > 0 ? Math.round((c.difficultyTotal / c.difficultyCount) * 10) / 10 : null,
        difficultyCount: c.difficultyCount,
        lastUsed: c.lastUsed,
      }));

    // Recent activities come from actual prior-ledger lines (true recency),
    // newest ledger first, deduplicated by side+label and capped per side.
    // Exclusion is side-scoped: the same label on the other side stays offered.
    const existingSideHashes = new Set(
      lines.filter((l) => l.labelHash).map((l) => `${l.side}:${l.labelHash}`),
    );
    const RECENT_PER_SIDE = 5;
    const recent: {
      id: string;
      side: string;
      labelCiphertext: string;
      labelIv: string;
      labelHash: string;
      typicalCost: number;
      lastUsed: string;
    }[] = [];
    const seen = new Set<string>();
    const perSide: Record<string, number> = { deposit: 0, withdrawal: 0 };
    outer: for (const ledger of await priorClosedLedgers(day)) {
      for (const line of await linesForDay(ledger.id)) {
        if (!line.labelHash) continue;
        const key = `${line.side}:${line.labelHash}`;
        if (existingSideHashes.has(key) || seen.has(key)) continue;
        if ((perSide[line.side] ?? 0) >= RECENT_PER_SIDE) continue;
        seen.add(key);
        perSide[line.side] = (perSide[line.side] ?? 0) + 1;
        recent.push({
          id: line.id,
          side: line.side,
          labelCiphertext: line.labelCiphertext,
          labelIv: line.labelIv,
          labelHash: line.labelHash,
          typicalCost: line.plannedCost,
          lastUsed: ledger.date,
        });
        if (perSide.deposit! >= RECENT_PER_SIDE && perSide.withdrawal! >= RECENT_PER_SIDE) {
          break outer;
        }
      }
    }
    return { suggestions, recent };
  })
  .get(
    "/stats",
    async ({ query, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const fromAt = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
      const toAt = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
      const metricAt = sql`COALESCE(${dayTable.closedAt}, ${dayTable.startedAt})`;
      let days = await db
        .select()
        .from(dayTable)
        .where(
          and(
            eq(dayTable.userId, user.id),
            fromAt ? gte(metricAt, fromAt.getTime()) : undefined,
            toAt ? lte(metricAt, toAt.getTime()) : undefined,
          ),
        )
        .orderBy(dayTable.startedAt, dayTable.id);

      // Spanning days can start before the visible range but still be the live sheet.
      const active = await db.query.dayTable.findFirst({
        where: and(eq(dayTable.userId, user.id), ne(dayTable.phase, "closed")),
      });
      if (active && !days.some((d) => d.id === active.id)) {
        days = [...days, active].sort(
          (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
        );
      }

      const lines = days.length
        ? await db.select().from(taskLineTable).where(inArray(taskLineTable.dayId, days.map((day) => day.id)))
        : [];
      const linesByDay = new Map<string, (typeof taskLineTable.$inferSelect)[]>();
      for (const line of lines) {
        const group = linesByDay.get(line.dayId) ?? [];
        group.push(line);
        linesByDay.set(line.dayId, group);
      }
      const includeLines = query.lineDetail !== "false";
      const series = days.map((day) => statPointForDay(day, linesByDay.get(day.id) ?? [], includeLines));
      return { series };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        lineDetail: t.Optional(t.String()),
      }),
    },
  );
