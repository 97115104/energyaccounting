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
import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
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

async function linesForDay(dayId: string) {
  return db
    .select()
    .from(taskLineTable)
    .where(eq(taskLineTable.dayId, dayId))
    .orderBy(taskLineTable.sort);
}

/** Closed ledgers accept amendments; keep the stored closing balance honest after each one. */
async function refreshClosedBalance(day: typeof dayTable.$inferSelect) {
  if (day.phase !== "closed") return;
  const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, day.id));
  const tasks: TaskCosts[] = lines.map((l) => ({
    side: l.side as TaskCosts["side"],
    planned: l.plannedCost,
    actual: l.actualCost,
  }));
  await db
    .update(dayTable)
    .set({ closingBalance: closingBalance(day.openingBalance, tasks) })
    .where(eq(dayTable.id, day.id));
}

/** Plaintext stat row for one ledger, shared by /stats and export. */
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
    return serializeDay(day, await linesForDay(day.id));
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
      // Amendments to a closed ledger record what actually happened, so the
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
      await db.insert(taskLineTable).values({
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
      });
      const bit = weekdayBit(day.date);
      const catalog = await db.query.taskCatalogTable.findFirst({
        where: and(
          eq(taskCatalogTable.userId, user.id),
          eq(taskCatalogTable.labelHash, body.labelHash),
          eq(taskCatalogTable.side, body.side),
        ),
      });
      if (catalog) {
        await db
          .update(taskCatalogTable)
          .set({
            typicalCost: planned,
            useCount: catalog.useCount + 1,
            difficultyTotal: catalog.difficultyTotal + (difficulty ?? 0),
            difficultyCount: catalog.difficultyCount + (difficulty === null ? 0 : 1),
            lastUsed: day.date,
            weekdayMask: catalog.weekdayMask | bit,
            labelCiphertext: body.labelCiphertext,
            labelIv: body.labelIv,
          })
          .where(eq(taskCatalogTable.id, catalog.id));
      } else {
        await db.insert(taskCatalogTable).values({
          id: newId(),
          userId: user.id,
          side: body.side,
          labelCiphertext: body.labelCiphertext,
          labelIv: body.labelIv,
          labelHash: body.labelHash,
          typicalCost: planned,
          weekdayMask: bit,
          useCount: 1,
          difficultyTotal: difficulty ?? 0,
          difficultyCount: difficulty === null ? 0 : 1,
          lastUsed: day.date,
        });
      }
      await refreshClosedBalance(day);
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
      if (nextDifficulty !== line.difficulty || catalogKeyChanged) {
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

      await db
        .update(taskLineTable)
        .set({
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
        })
        .where(eq(taskLineTable.id, line.id));
      await refreshClosedBalance(day);
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
    if (line.difficulty !== null) {
      await adjustCatalogDifficulty(user.id, line.labelHash, line.side, -line.difficulty, -1);
    }
    await db
      .delete(taskLineTable)
      .where(and(eq(taskLineTable.id, params.lineId), eq(taskLineTable.dayId, day.id)));
    await refreshClosedBalance(day);
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
    // Foreign-key cascading removes the encrypted lines with the ledger.
    await db.delete(dayTable).where(eq(dayTable.id, day.id));
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
      // A closed ledger accepts amendments to its reflections but never
      // returns to the plan/audit lifecycle: one active ledger at a time.
      if (day.phase === "closed" && body.phase !== undefined) {
        set.status = 400;
        return { error: "A closed ledger cannot be reopened." };
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
    return { suggestions };
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

      // Spanning ledgers can start before the visible range but still be the live sheet.
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
