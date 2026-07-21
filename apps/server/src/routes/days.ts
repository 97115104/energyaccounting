import {
  attwoodTotals,
  availableCapacity,
  clampCost,
  closingBalance,
  openingBalance,
  reservedCapacity,
  type AllocatableTask,
  type TaskCosts,
} from "@eaj/shared";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
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

/** Last closed day strictly before dateIso (no row-count cap). */
async function previousClosing(userId: string, dateIso: string): Promise<number | null> {
  const rows = await db
    .select()
    .from(dayTable)
    .where(
      and(
        eq(dayTable.userId, userId),
        lt(dayTable.date, dateIso),
        eq(dayTable.phase, "closed"),
      ),
    )
    .orderBy(desc(dayTable.date))
    .limit(1);
  const row = rows[0];
  if (!row || row.closingBalance === null) return null;
  return row.closingBalance;
}

async function ensureDay(userId: string, dateIso: string) {
  let day = await db.query.dayTable.findFirst({
    where: and(eq(dayTable.userId, userId), eq(dayTable.date, dateIso)),
  });
  const user = await db.query.userTable.findFirst({ where: eq(userTable.id, userId) });

  if (day) {
    const weather = day.weatherJson ? (JSON.parse(day.weatherJson) as Record<string, unknown>) : {};
    if (user?.lat != null && user?.lon != null && weather.tempMax == null) {
      const fresh = await fetchDayWeather(user.lat, user.lon, dateIso);
      const hol = holidayForDate(dateIso, user.country ?? "US");
      const payload = fresh
        ? { ...fresh, holidayName: hol.name }
        : { ...weather, holidayName: hol.name };
      await db
        .update(dayTable)
        .set({
          weatherJson: JSON.stringify(payload),
          isHoliday: hol.isHoliday,
        })
        .where(eq(dayTable.id, day.id));
      day = (await db.query.dayTable.findFirst({ where: eq(dayTable.id, day.id) }))!;
    }
    return day;
  }

  const opening = openingBalance(await previousClosing(userId, dateIso));
  const hol = holidayForDate(dateIso, user?.country ?? "US");
  let weather: Record<string, unknown> | null = null;
  if (user?.lat != null && user?.lon != null) {
    weather = await fetchDayWeather(user.lat, user.lon, dateIso);
  }
  const id = newId();
  await db.insert(dayTable).values({
    id,
    userId,
    date: dateIso,
    openingBalance: opening,
    phase: "plan",
    isHoliday: hol.isHoliday,
    weatherJson: weather
      ? JSON.stringify({ ...weather, holidayName: hol.name })
      : JSON.stringify({ holidayName: hol.name }),
  });
  day = await db.query.dayTable.findFirst({ where: eq(dayTable.id, id) });
  return day!;
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
    openingBalance: day.openingBalance,
    closingBalance: day.closingBalance,
    projectedClosing: projected,
    availableCapacity: availableCapacity(day.openingBalance, tasks),
    phase: day.phase,
    feelRating: day.feelRating,
    journalCiphertext: day.journalCiphertext,
    journalIv: day.journalIv,
    audioPath: day.audioPath,
    audioIv: day.audioIv,
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
    })),
  };
}

export const dayRoutes = new Elysia({ prefix: "/api" })
  .get("/days/:date", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let date: string;
    try {
      date = assertIsoDate(params.date);
    } catch {
      set.status = 400;
      return { error: "Invalid date." };
    }
    const day = await ensureDay(user.id, date);
    const lines = await db
      .select()
      .from(taskLineTable)
      .where(eq(taskLineTable.dayId, day.id))
      .orderBy(taskLineTable.sort);
    return serializeDay(day, lines);
  })
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
        .orderBy(dayTable.date);
      return {
        days: rows.map((d) => ({
          id: d.id,
          date: d.date,
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
      .orderBy(dayTable.date);
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
      schemaVersion: 1,
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
        lastUsed: c.lastUsed,
      })),
    };
  })
  .post(
    "/days/:date/lines",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      let date: string;
      try {
        date = assertIsoDate(params.date);
      } catch {
        set.status = 400;
        return { error: "Invalid date." };
      }
      const day = await ensureDay(user.id, date);
      if (day.phase === "closed") {
        set.status = 400;
        return { error: "Day is closed." };
      }
      const planned = clampCost(body.plannedCost);
      const actual =
        body.actualCost === undefined || body.actualCost === null
          ? null
          : clampCost(body.actualCost);
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
      const avail = availableCapacity(day.openingBalance, allocatable);
      if (planned > avail) {
        set.status = 400;
        return {
          error: `That uses ${planned} points, and only ${avail} remain available to allocate.`,
        };
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
      });
      const bit = weekdayBit(date);
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
            lastUsed: date,
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
          lastUsed: date,
        });
      }
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
      }),
    },
  )
  .patch(
    "/days/:date/lines/:lineId",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      let date: string;
      try {
        date = assertIsoDate(params.date);
      } catch {
        set.status = 400;
        return { error: "Invalid date." };
      }
      const day = await ensureDay(user.id, date);
      if (day.phase === "closed") {
        set.status = 400;
        return { error: "Day is closed." };
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
          side: (body.side ?? line.side) as TaskCosts["side"],
          planned: nextPlanned,
          actual: nextActual,
          completed: nextCompleted,
        };
      });
      if (reservedCapacity(projected) > day.openingBalance) {
        set.status = 400;
        return { error: "That change would reserve more points than remain available." };
      }

      await db
        .update(taskLineTable)
        .set({
          plannedCost: nextPlanned,
          actualCost: nextActual,
          labelCiphertext: body.labelCiphertext ?? line.labelCiphertext,
          labelIv: body.labelIv ?? line.labelIv,
          completed: nextCompleted,
          side: body.side ?? line.side,
          sort: body.sort === undefined ? line.sort : body.sort,
        })
        .where(eq(taskLineTable.id, line.id));
      return { ok: true };
    },
    {
      body: t.Object({
        plannedCost: t.Optional(t.Number()),
        actualCost: t.Optional(t.Nullable(t.Number())),
        labelCiphertext: t.Optional(t.String()),
        labelIv: t.Optional(t.String()),
        completed: t.Optional(t.Boolean()),
        side: t.Optional(t.Union([t.Literal("deposit"), t.Literal("withdrawal")])),
        sort: t.Optional(t.Number()),
      }),
    },
  )
  .delete("/days/:date/lines/:lineId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let date: string;
    try {
      date = assertIsoDate(params.date);
    } catch {
      set.status = 400;
      return { error: "Invalid date." };
    }
    const day = await ensureDay(user.id, date);
    if (day.phase === "closed") {
      set.status = 400;
      return { error: "Day is closed." };
    }
    await db
      .delete(taskLineTable)
      .where(and(eq(taskLineTable.id, params.lineId), eq(taskLineTable.dayId, day.id)));
    return { ok: true };
  })
  .patch(
    "/days/:date",
    async ({ params, body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      let date: string;
      try {
        date = assertIsoDate(params.date);
      } catch {
        set.status = 400;
        return { error: "Invalid date." };
      }
      const day = await ensureDay(user.id, date);
      if (day.phase === "closed") {
        set.status = 400;
        return { error: "Day is closed." };
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
          audioPath: body.audioPath === undefined ? day.audioPath : body.audioPath,
          audioIv: body.audioIv === undefined ? day.audioIv : body.audioIv,
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
        audioPath: t.Optional(t.Nullable(t.String())),
        audioIv: t.Optional(t.Nullable(t.String())),
      }),
    },
  )
  .post("/days/:date/close", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let date: string;
    try {
      date = assertIsoDate(params.date);
    } catch {
      set.status = 400;
      return { error: "Invalid date." };
    }
    const day = await ensureDay(user.id, date);
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
    const opening = openingBalance(await previousClosing(user.id, date));
    const closing = closingBalance(opening, tasks);
    await db
      .update(dayTable)
      .set({ phase: "closed", openingBalance: opening, closingBalance: closing })
      .where(eq(dayTable.id, day.id));
    return { closingBalance: closing, openingBalance: opening, attwood: attwoodTotals(tasks) };
  })
  .get("/suggestions/:date", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    let date: string;
    try {
      date = assertIsoDate(params.date);
    } catch {
      set.status = 400;
      return { error: "Invalid date." };
    }
    const day = await ensureDay(user.id, date);
    const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, day.id));
    const existingHashes = new Set(lines.map((l) => l.labelHash).filter(Boolean));
    const bit = weekdayBit(date);
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
        useCount: c.useCount,
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
      const days = await db
        .select()
        .from(dayTable)
        .where(
          and(
            eq(dayTable.userId, user.id),
            query.from ? gte(dayTable.date, query.from) : undefined,
            query.to ? lte(dayTable.date, query.to) : undefined,
          ),
        )
        .orderBy(dayTable.date);

      const series = [];
      for (const d of days) {
        const lines = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, d.id));
        const tasks: TaskCosts[] = lines.map((l) => ({
          side: l.side as TaskCosts["side"],
          planned: l.plannedCost,
          actual: l.actualCost,
        }));
        const attwood = attwoodTotals(tasks);
        series.push({
          date: d.date,
          openingBalance: d.openingBalance,
          closingBalance: d.closingBalance ?? closingBalance(d.openingBalance, tasks),
          attwoodNet: attwood.attwoodNet,
          depositTotal: attwood.depositTotal,
          withdrawalTotal: attwood.withdrawalTotal,
          isHoliday: d.isHoliday,
          weather: d.weatherJson ? JSON.parse(d.weatherJson) : null,
          feelRating: d.feelRating,
        });
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
