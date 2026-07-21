import {
  DAILY_ENERGY,
  attwoodTotals,
  availableCapacity,
  clampCost,
  clampDifficulty,
  closingBalance,
  completedFreedEnergy,
  reservedCapacity,
  type AllocatableTask,
  type TaskCosts,
} from "@eaj/shared";
import { and, desc, eq, gte, lt, lte, ne, or } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/index.ts";
import { dayTable, taskCatalogTable, taskLineTable, userTable } from "../db/schema.ts";
import { holidayForDate } from "../lib/holidays.ts";
import { assertIsoDate, newId, requireFullUser } from "../lib/session.ts";
import { fetchDayWeather } from "../lib/weather.ts";

function weekdayBit(dateIso: string): number {
  const d = new Date(dateIso + "T12:00:00Z");
  return 1 << d.getUTCDay();
}

/** Keep catalog difficulty means correct when a rated line moves, clears, or is deleted. */
async function adjustCatalogDifficulty(
  userId: string,
  labelHash: string,
  side: string,
  totalDelta: number,
  countDelta: number,
) {
  if (!labelHash || (totalDelta === 0 && countDelta === 0)) return;
  const catalog = await db.query.taskCatalogTable.findFirst({
    where: and(
      eq(taskCatalogTable.userId, userId),
      eq(taskCatalogTable.labelHash, labelHash),
      eq(taskCatalogTable.side, side),
    ),
  });
  if (!catalog) return;
  await db
    .update(taskCatalogTable)
    .set({
      difficultyTotal: Math.max(0, catalog.difficultyTotal + totalDelta),
      difficultyCount: Math.max(0, catalog.difficultyCount + countDelta),
    })
    .where(eq(taskCatalogTable.id, catalog.id));
}

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

/** Record one live use of an activity, shared by manual line adds and plan repeats. */
async function upsertCatalogUse(
  userId: string,
  day: typeof dayTable.$inferSelect,
  line: {
    side: string;
    labelCiphertext: string;
    labelIv: string;
    labelHash: string;
    plannedCost: number;
    difficulty: number | null;
  },
  executor: WriteDb = db,
) {
  if (!line.labelHash) return;
  const bit = weekdayBit(day.date);
  const [catalog] = await executor
    .select()
    .from(taskCatalogTable)
    .where(
      and(
        eq(taskCatalogTable.userId, userId),
        eq(taskCatalogTable.labelHash, line.labelHash),
        eq(taskCatalogTable.side, line.side),
      ),
    );
  if (catalog) {
    await executor
      .update(taskCatalogTable)
      .set({
        typicalCost: line.plannedCost,
        useCount: catalog.useCount + 1,
        difficultyTotal: catalog.difficultyTotal + (line.difficulty ?? 0),
        difficultyCount: catalog.difficultyCount + (line.difficulty === null ? 0 : 1),
        lastUsed: day.date,
        weekdayMask: catalog.weekdayMask | bit,
        labelCiphertext: line.labelCiphertext,
        labelIv: line.labelIv,
      })
      .where(eq(taskCatalogTable.id, catalog.id));
  } else {
    await executor.insert(taskCatalogTable).values({
      id: newId(),
      userId,
      side: line.side,
      labelCiphertext: line.labelCiphertext,
      labelIv: line.labelIv,
      labelHash: line.labelHash,
      typicalCost: line.plannedCost,
      weekdayMask: bit,
      useCount: 1,
      difficultyTotal: line.difficulty ?? 0,
      difficultyCount: line.difficulty === null ? 0 : 1,
      lastUsed: day.date,
    });
  }
}

/** Ledgers strictly earlier than `day` in lifecycle order (startedAt, then id). */
function strictlyEarlierThan(day: typeof dayTable.$inferSelect) {
  return or(
    lt(dayTable.startedAt, day.startedAt),
    and(eq(dayTable.startedAt, day.startedAt), lt(dayTable.id, day.id)),
  );
}

/** Bound history scans so repeat/recent work stays a small ordered window. */
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

/**
 * Repeat source: the most recently closed prior ledger that actually has
 * tasks. Empty closed ledgers are skipped rather than blocking repeat.
 */
async function previousPlanSource(day: typeof dayTable.$inferSelect) {
  for (const candidate of await priorClosedLedgers(day)) {
    const lines = await linesForDay(candidate.id);
    if (lines.length > 0) return { day: candidate, lines };
  }
  return null;
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
  const entries = new Map<
    string,
    {
      side: string;
      labelCiphertext: string;
      labelIv: string;
      labelHash: string;
      typicalCost: number;
      weekdayMask: number;
      useCount: number;
      difficultyTotal: number;
      difficultyCount: number;
      lastUsed: string;
    }
  >();
  for (const day of days) {
    const lines = await linesForDay(day.id, executor);
    for (const line of lines) {
      if (!line.labelHash) continue;
      const key = `${line.side}:${line.labelHash}`;
      const current = entries.get(key);
      entries.set(key, {
        side: line.side,
        labelCiphertext: line.labelCiphertext,
        labelIv: line.labelIv,
        labelHash: line.labelHash,
        typicalCost: line.plannedCost,
        weekdayMask: (current?.weekdayMask ?? 0) | weekdayBit(day.date),
        useCount: (current?.useCount ?? 0) + 1,
        difficultyTotal: (current?.difficultyTotal ?? 0) + (line.difficulty ?? 0),
        difficultyCount: (current?.difficultyCount ?? 0) + (line.difficulty === null ? 0 : 1),
        lastUsed: day.date,
      });
    }
  }
  await executor.delete(taskCatalogTable).where(eq(taskCatalogTable.userId, userId));
  for (const entry of entries.values()) {
    await executor.insert(taskCatalogTable).values({ id: newId(), userId, ...entry });
  }
}

/** Plaintext stat row for one day, shared by /stats and export. */
async function statPointForDay(d: typeof dayTable.$inferSelect) {
  const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, d.id));
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
    date: day.date,
    startedAt: day.startedAt.toISOString(),
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
      side: l.side,
      sort: l.sort,
      labelCiphertext: l.labelCiphertext,
      labelIv: l.labelIv,
      labelHash: l.labelHash,
      plannedCost: l.plannedCost,
      actualCost: l.actualCost,
      completed: l.completed,
      difficulty: l.difficulty,
      detailsCiphertext: l.detailsCiphertext,
      detailsIv: l.detailsIv,
    })),
  };
}

/**
 * Serialize plus repeat availability, so every path that can render the
 * editable day (active, ID fetch, start, repeat) reports the same metadata.
 * The history scan only runs for an empty planning day.
 */
async function serializeDayWithRepeat(
  day: typeof dayTable.$inferSelect,
  lines: (typeof taskLineTable.$inferSelect)[],
) {
  const canRepeat =
    day.phase === "plan" && lines.length === 0 && (await previousPlanSource(day)) !== null;
  return { ...serializeDay(day, lines), repeatAvailable: canRepeat };
}

export const dayRoutes = new Elysia({ prefix: "/api" })
  .get("/days/active", async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const day = await db.query.dayTable.findFirst({
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
    const lines = await linesForDay(day.id);
    return { day: await serializeDayWithRepeat(day, lines) };
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
        return await serializeDayWithRepeat(day, []);
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
    const day = await ownedDay(user.id, params.dayId);
    if (!day) {
      set.status = 404;
      return { error: "Day not found." };
    }
    return await serializeDayWithRepeat(day, await linesForDay(day.id));
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
    return {
      schemaVersion: 4,
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        timezone: user.timezone,
        lat: user.lat,
        lon: user.lon,
        country: user.country,
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
      // live capacity guard does not apply to them.
      const avail = availableCapacity(day.openingBalance, allocatable);
      if (day.phase !== "closed" && planned > avail) {
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
        difficulty,
        detailsCiphertext: details.ciphertext,
        detailsIv: details.iv,
      };
      if (day.phase === "closed") {
        await db.transaction(async (tx) => {
          await tx.insert(taskLineTable).values(newLine);
          await rebuildCatalog(user.id, tx);
          await refreshClosedBalance(day, tx);
        });
        return { id };
      }

      await db.insert(taskLineTable).values(newLine);
      await upsertCatalogUse(user.id, day, {
        side: body.side,
        labelCiphertext: body.labelCiphertext,
        labelIv: body.labelIv,
        labelHash: body.labelHash,
        plannedCost: planned,
        difficulty,
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
      if (day.phase !== "closed" && reservedCapacity(projected) > day.openingBalance) {
        set.status = 400;
        return { error: "That change would reserve more points than remain available." };
      }

      // Move difficulty samples when rating, side, or label identity changes.
      const catalogKeyChanged =
        nextLabelHash !== line.labelHash || nextSide !== line.side;
      if (day.phase !== "closed" && (nextDifficulty !== line.difficulty || catalogKeyChanged)) {
        if (line.difficulty !== null) {
          await adjustCatalogDifficulty(
            user.id,
            line.labelHash,
            line.side,
            -line.difficulty,
            -1,
          );
        }
        if (nextDifficulty !== null) {
          await adjustCatalogDifficulty(
            user.id,
            nextLabelHash,
            nextSide,
            nextDifficulty,
            1,
          );
        }
      }

      const changes = {
        plannedCost: nextPlanned,
        actualCost: nextActual,
        labelCiphertext: body.labelCiphertext ?? line.labelCiphertext,
        labelIv: body.labelIv ?? line.labelIv,
        labelHash: nextLabelHash,
        completed: nextCompleted,
        difficulty: nextDifficulty,
        detailsCiphertext: nextDetailsCiphertext,
        detailsIv: nextDetailsIv,
        side: nextSide,
        sort: body.sort === undefined ? line.sort : body.sort,
      };
      if (day.phase === "closed") {
        await db.transaction(async (tx) => {
          await tx.update(taskLineTable).set(changes).where(eq(taskLineTable.id, line.id));
          await rebuildCatalog(user.id, tx);
          await refreshClosedBalance(day, tx);
        });
      } else {
        await db.update(taskLineTable).set(changes).where(eq(taskLineTable.id, line.id));
      }
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
    await db
      .update(dayTable)
      .set({ phase: "closed", openingBalance: opening, closingBalance: closing })
      .where(eq(dayTable.id, day.id));
    return { closingBalance: closing, openingBalance: opening, attwood: attwoodTotals(tasks) };
  })
  .post("/days/:dayId/repeat-previous", async ({ params, request, set }) => {
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
    if (day.phase !== "plan") {
      set.status = 400;
      return { error: "The previous plan can only be repeated while planning." };
    }
    const existing = await linesForDay(day.id);
    if (existing.length > 0) {
      set.status = 409;
      return { error: "This day already has tasks; repeat works on an empty plan." };
    }
    const source = await previousPlanSource(day);
    if (!source) {
      set.status = 400;
      return { error: "No previous plan to repeat yet." };
    }
    // All-or-nothing: the whole previous plan must fit today's capacity.
    const plannedTotal = source.lines.reduce((sum, l) => sum + clampCost(l.plannedCost), 0);
    const avail = availableCapacity(day.openingBalance, []);
    if (plannedTotal > avail) {
      set.status = 400;
      return {
        error: `The previous plan uses ${plannedTotal} points, and only ${avail} remain available to allocate.`,
      };
    }
    try {
      await db.transaction(async (tx) => {
        // Re-check emptiness inside the transaction so a double submit
        // cannot interleave and copy the plan twice.
        const current = await linesForDay(day.id, tx);
        if (current.length > 0) throw new Error("repeat-target-not-empty");
        // Copy lines without catalog upserts: one repeat tap remembers the
        // plan but must not bump useCount/ranking like N manual adds.
        for (const [i, line] of source.lines.entries()) {
          await tx.insert(taskLineTable).values({
            id: newId(),
            dayId: day.id,
            side: line.side,
            sort: i,
            labelCiphertext: line.labelCiphertext,
            labelIv: line.labelIv,
            labelHash: line.labelHash,
            plannedCost: clampCost(line.plannedCost),
            actualCost: null,
            completed: false,
            difficulty: null,
            detailsCiphertext: null,
            detailsIv: null,
          });
        }
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes("repeat-target-not-empty")) {
        set.status = 409;
        return { error: "This day already has tasks; repeat works on an empty plan." };
      }
      throw e;
    }
    const lines = await linesForDay(day.id);
    return { day: await serializeDayWithRepeat(day, lines) };
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
    const bit = weekdayBit(day.date);
    const catalog = await db
      .select()
      .from(taskCatalogTable)
      .where(eq(taskCatalogTable.userId, user.id))
      .orderBy(desc(taskCatalogTable.useCount));
    const suggestions = catalog
      .filter((c) => (c.weekdayMask & bit) !== 0 || c.useCount >= 2)
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
      let days = await db
        .select()
        .from(dayTable)
        .where(
          and(
            eq(dayTable.userId, user.id),
            fromAt ? gte(dayTable.startedAt, fromAt) : undefined,
            toAt ? lte(dayTable.startedAt, toAt) : undefined,
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

      const series = [];
      for (const d of days) {
        series.push(await statPointForDay(d));
      }
      return { series };
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
      }),
    },
  );
