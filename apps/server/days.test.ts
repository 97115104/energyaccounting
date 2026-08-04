import { beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "eaj-days-test-"));
process.env.DATA_DIR = dataDir;
process.on("exit", () => {
  rmSync(dataDir, { recursive: true, force: true });
});

const { migrateDatabase } = await import("./src/db/migrate.ts");
migrateDatabase(dataDir);

const [{ dayRoutes }, { db }, schema, session] = await Promise.all([
  import("./src/routes/days.ts"),
  import("./src/db/index.ts"),
  import("./src/db/schema.ts"),
  import("./src/lib/session.ts"),
]);

const { dayTable, taskCatalogTable, taskLineTable, userTable, youProfileTable } = schema;
const { createSession } = session;

function userRow(id: string, email: string) {
  return {
    id,
    email,
    passwordHash: "unused",
    kekSalt: "salt",
    wrappedDek: "wrapped",
    timezone: "UTC",
    onboardingCompleted: true,
    locationPrompted: true,
    createdAt: new Date(),
  };
}

function dayRow(id: string, userId: string, phase: "plan" | "closed", offset: number) {
  return {
    id,
    userId,
    date: "2026-07-21",
    startedAt: new Date(Date.now() + offset),
    openingBalance: 100,
    closingBalance: phase === "closed" ? 100 : null,
    phase,
  };
}

function lineRow(id: string, dayId: string, labelHash: string) {
  return {
    id,
    dayId,
    side: "deposit",
    sort: 0,
    labelCiphertext: `cipher-${id}`,
    labelIv: `iv-${id}`,
    labelHash,
    plannedCost: 20,
    actualCost: 20,
    completed: true,
  };
}

let ownerToken = "";
let otherToken = "";
let emptyToken = "";
let amendToken = "";

async function makeAuthedUser(prefix: string): Promise<{ userId: string; token: string }> {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await db.insert(userTable).values(userRow(userId, `${userId}@example.com`));
  return { userId, token: (await createSession(userId, false)).token };
}

beforeAll(async () => {
  await db.insert(userTable).values([
    userRow("owner", "owner@example.com"),
    userRow("other", "other@example.com"),
    userRow("empty", "empty@example.com"),
    userRow("amender", "amender@example.com"),
  ]);
  ownerToken = (await createSession("owner", false)).token;
  otherToken = (await createSession("other", false)).token;
  emptyToken = (await createSession("empty", false)).token;
  amendToken = (await createSession("amender", false)).token;
  await db.insert(dayTable).values([
    dayRow("closed-day", "owner", "closed", -2),
    dayRow("active-day", "owner", "plan", -1),
    dayRow("amend-day", "amender", "closed", 0),
  ]);
  await db.insert(taskLineTable).values([
    lineRow("closed-line", "closed-day", "closed-hash"),
    lineRow("active-line", "active-day", "active-hash"),
    lineRow("amend-line", "amend-day", "amend-hash"),
  ]);
  await db.insert(taskCatalogTable).values([
    {
      id: "closed-catalog",
      userId: "owner",
      side: "deposit",
      labelCiphertext: "cipher-closed-line",
      labelIv: "iv-closed-line",
      labelHash: "closed-hash",
      typicalCost: 20,
      weekdayMask: 127,
      useCount: 1,
      difficultyTotal: 0,
      difficultyCount: 0,
      lastUsed: "2026-07-21",
    },
    {
      id: "active-catalog",
      userId: "owner",
      side: "deposit",
      labelCiphertext: "cipher-active-line",
      labelIv: "iv-active-line",
      labelHash: "active-hash",
      typicalCost: 20,
      weekdayMask: 127,
      useCount: 1,
      difficultyTotal: 0,
      difficultyCount: 0,
      lastUsed: "2026-07-21",
    },
    {
      id: "amend-catalog",
      userId: "amender",
      side: "deposit",
      labelCiphertext: "cipher-amend-line",
      labelIv: "iv-amend-line",
      labelHash: "amend-hash",
      typicalCost: 20,
      weekdayMask: 127,
      useCount: 1,
      difficultyTotal: 0,
      difficultyCount: 0,
      lastUsed: "2026-07-21",
    },
  ]);
});

function apiRequest(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `eaj_session=${token}`);
  return dayRoutes.handle(
    new Request(`http://localhost/api${path}`, {
      ...init,
      headers,
    }),
  );
}

function deleteRequest(dayId: string, token: string) {
  return apiRequest(`/days/${dayId}`, token, { method: "DELETE" });
}

function restoreUser(displayName = "Imported person") {
  return {
    displayName,
    timezone: "America/Los_Angeles",
    lat: 37.77,
    lon: -122.42,
    country: "US",
    temperatureUnit: "F" as const,
    greetingStyle: "facts" as const,
    includePhysicalActivities: false,
    onboardingCompleted: true,
    locationPrompted: true,
    identity: null,
  };
}

function restoredLine(sourceId: string, side: "deposit" | "withdrawal" = "deposit") {
  return {
    sourceId,
    side,
    sort: 0,
    labelCiphertext: `cipher-${sourceId}`,
    labelIv: `iv-${sourceId}`,
    labelHash: `hash-${sourceId}`,
    plannedCost: side === "deposit" ? 25 : 5,
    actualCost: side === "deposit" ? 25 : 5,
    completed: true,
    completedAt: "2026-07-01T17:00:00.000Z",
    difficulty: 3,
    detailsCiphertext: `details-${sourceId}`,
    detailsIv: `details-iv-${sourceId}`,
  };
}

function restoredDay(
  sourceId: string,
  phase: "plan" | "audit" | "closed" = "closed",
  lines = [restoredLine(`${sourceId}-line`)],
) {
  return {
    sourceId,
    date: "2026-07-01",
    startedAt: "2026-07-01T08:00:00.000Z",
    closedAt: phase === "closed" ? "2026-07-01T18:00:00.000Z" : null,
    openingBalance: 100,
    phase,
    feelRating: 7,
    weather: { v: 3, timezone: "America/Los_Angeles" },
    isHoliday: false,
    journalCiphertext: `journal-${sourceId}`,
    journalIv: `journal-iv-${sourceId}`,
    compensateNoteCiphertext: null,
    compensateNoteIv: null,
    legacyQualitative: null,
    lines,
  };
}

function restorePayload(
  mode: "merge" | "replace",
  days = [restoredDay("imported-day")],
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 7,
    mode,
    user: restoreUser(),
    youProfile: {
      ciphertext: "profile-cipher",
      iv: "profile-iv",
      updatedAt: "2026-07-01T19:00:00.000Z",
    },
    days,
    ...overrides,
  };
}

describe("day lifecycle", () => {
  test("active reads do not create a day; starts are explicit, fresh, unique, and date-repeatable", async () => {
    const before = await db.query.dayTable.findMany({
      where: (day, { eq }) => eq(day.userId, "empty"),
    });
    expect(before).toHaveLength(0);

    const active = await apiRequest("/days/active", emptyToken);
    expect(active.status).toBe(200);
    expect(await active.json()).toEqual({ day: null });
    expect(await db.query.dayTable.findMany({
      where: (day, { eq }) => eq(day.userId, "empty"),
    })).toHaveLength(0);

    const first = await apiRequest("/days/start", emptyToken, {
      method: "POST",
      headers: {
        cookie: `eaj_session=${emptyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ date: "2026-07-21" }),
    });
    expect(first.status).toBe(201);
    const firstDay = await first.json() as { id: string; openingBalance: number };
    expect(firstDay.openingBalance).toBe(100);

    const conflict = await apiRequest("/days/start", emptyToken, {
      method: "POST",
      headers: {
        cookie: `eaj_session=${emptyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ date: "2026-07-21" }),
    });
    expect(conflict.status).toBe(409);

    expect((await apiRequest(`/days/${firstDay.id}/close`, emptyToken, {
      method: "POST",
    })).status).toBe(200);
    const second = await apiRequest("/days/start", emptyToken, {
      method: "POST",
      headers: {
        cookie: `eaj_session=${emptyToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ date: "2026-07-21" }),
    });
    expect(second.status).toBe(201);
    const secondDay = await second.json() as { id: string; openingBalance: number };
    expect(secondDay.id).not.toBe(firstDay.id);
    expect(secondDay.openingBalance).toBe(100);
  });

  test("closed amendments recompute energy remaining and cannot reopen the day", async () => {
    const changed = await apiRequest("/days/amend-day/lines/amend-line", amendToken, {
      method: "PATCH",
      headers: {
        cookie: `eaj_session=${amendToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ actualCost: 50 }),
    });
    expect(changed.status).toBe(200);
    const amended = await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "amend-day"),
    });
    expect(amended?.phase).toBe("closed");
    expect(amended?.closingBalance).toBe(150);

    const reopen = await apiRequest("/days/amend-day", amendToken, {
      method: "PATCH",
      headers: {
        cookie: `eaj_session=${amendToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ phase: "audit" }),
    });
    expect(reopen.status).toBe(400);

    const removed = await apiRequest("/days/amend-day/lines/amend-line", amendToken, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect((await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "amend-day"),
    }))?.closingBalance).toBe(100);
    expect(await db.query.taskCatalogTable.findFirst({
      where: (entry, { eq }) => eq(entry.labelHash, "amend-hash"),
    })).toBeUndefined();

    const added = await apiRequest("/days/amend-day/lines", amendToken, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        side: "deposit",
        labelCiphertext: "new-cipher",
        labelIv: "new-iv",
        labelHash: "new-hash",
        plannedCost: 30,
        actualCost: 30,
      }),
    });
    expect(added.status).toBe(200);
    expect((await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "amend-day"),
    }))?.closingBalance).toBe(130);
    expect((await db.query.taskCatalogTable.findFirst({
      where: (entry, { eq }) => eq(entry.labelHash, "new-hash"),
    }))?.useCount).toBe(1);
  });

  test("closing a day records the actual close instant and stats range by it", async () => {
    const { userId, token } = await makeAuthedUser("closer");
    await db.insert(dayTable).values({
      id: "close-range-day",
      userId,
      date: "2026-07-01",
      startedAt: new Date(Date.now() - 2 * 86_400_000),
      openingBalance: 100,
      closingBalance: null,
      phase: "plan",
    });
    await db.insert(taskLineTable).values({
      id: "close-range-line",
      dayId: "close-range-day",
      side: "withdrawal",
      sort: 0,
      labelCiphertext: "cipher-close-range",
      labelIv: "iv-close-range",
      labelHash: "close-range-hash",
      plannedCost: 15,
      actualCost: 20,
      completed: true,
    });

    const closed = await apiRequest("/days/close-range-day/close", token, { method: "POST" });
    expect(closed.status).toBe(200);
    const closeBody = (await closed.json()) as { closedAt: string };
    expect(Date.parse(closeBody.closedAt)).toBeGreaterThan(0);
    const row = await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "close-range-day"),
    });
    expect(row?.closedAt).toBeInstanceOf(Date);

    const today = new Date().toISOString().slice(0, 10);
    const stats = await apiRequest(`/stats?from=${today}&to=${today}`, token);
    expect(stats.status).toBe(200);
    const statsBody = (await stats.json()) as {
      series: Array<{
        id: string;
        closedAt: string | null;
        durationMinutes: number | null;
        lines?: Array<{
          side: string;
          labelCiphertext: string;
          labelIv: string;
          labelHash: string;
          plannedCost: number;
          actualCost: number | null;
          completed: boolean;
          label?: string;
          details?: string;
        }>;
      }>;
    };
    expect(statsBody.series.some((point) => point.id === "close-range-day")).toBe(true);
    const point = statsBody.series.find((p) => p.id === "close-range-day")!;
    expect(point.closedAt).toBe(closeBody.closedAt);
    expect(point.durationMinutes).toBeGreaterThan(0);
    expect(point.lines).toEqual([
      expect.objectContaining({
        side: "withdrawal",
        labelCiphertext: "cipher-close-range",
        labelIv: "iv-close-range",
        labelHash: "close-range-hash",
        plannedCost: 15,
        actualCost: 20,
        completed: true,
      }),
    ]);
    expect(point.lines?.[0]).not.toHaveProperty("label");
    expect(point.lines?.[0]).not.toHaveProperty("details");
  });

  test("completion toggles store and clear completion timestamps", async () => {
    const { userId, token } = await makeAuthedUser("completer");
    await db.insert(dayTable).values({
      id: "completion-day",
      userId,
      date: "2026-07-22",
      startedAt: new Date(),
      openingBalance: 100,
      closingBalance: null,
      phase: "plan",
    });
    await db.insert(taskLineTable).values({
      id: "completion-line",
      dayId: "completion-day",
      side: "withdrawal",
      sort: 0,
      labelCiphertext: "cipher-completion",
      labelIv: "iv-completion",
      labelHash: "completion-hash",
      plannedCost: 20,
      actualCost: null,
      completed: false,
    });

    const done = await apiRequest("/days/completion-day/lines/completion-line", token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    expect(done.status).toBe(200);
    const completed = await db.query.taskLineTable.findFirst({
      where: (line, { eq }) => eq(line.id, "completion-line"),
    });
    expect(completed?.completed).toBe(true);
    expect(completed?.completedAt).toBeInstanceOf(Date);

    const undone = await apiRequest("/days/completion-day/lines/completion-line", token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ completed: false }),
    });
    expect(undone.status).toBe(200);
    const reopened = await db.query.taskLineTable.findFirst({
      where: (line, { eq }) => eq(line.id, "completion-line"),
    });
    expect(reopened?.completed).toBe(false);
    expect(reopened?.completedAt).toBeNull();
  });

  test("over-capacity withdrawal adds require an explicit confirmation flag", async () => {
    const { userId, token } = await makeAuthedUser("overbudget");
    await db.insert(dayTable).values({
      id: "overbudget-day",
      userId,
      date: "2026-07-23",
      startedAt: new Date(),
      openingBalance: 100,
      closingBalance: null,
      phase: "plan",
    });
    await db.insert(taskLineTable).values({
      id: "large-line",
      dayId: "overbudget-day",
      side: "withdrawal",
      sort: 0,
      labelCiphertext: "cipher-large",
      labelIv: "iv-large",
      labelHash: "large-hash",
      plannedCost: 90,
      actualCost: null,
      completed: false,
    });
    const body = {
      side: "withdrawal",
      labelCiphertext: "cipher-extra",
      labelIv: "iv-extra",
      labelHash: "extra-hash",
      plannedCost: 20,
    };
    const blocked = await apiRequest("/days/overbudget-day/lines", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(blocked.status).toBe(400);

    const confirmed = await apiRequest("/days/overbudget-day/lines", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, labelHash: "extra-confirmed", allowOverCapacity: true }),
    });
    expect(confirmed.status).toBe(200);
    const confirmedBody = (await confirmed.json()) as { id: string };

    const detailsOnly = await apiRequest(`/days/overbudget-day/lines/${confirmedBody.id}`, token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ detailsCiphertext: "notes-cipher", detailsIv: "notes-iv" }),
    });
    expect(detailsOnly.status).toBe(200);

    const movedToDeposit = await apiRequest(`/days/overbudget-day/lines/${confirmedBody.id}`, token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ side: "deposit", sort: 0 }),
    });
    expect(movedToDeposit.status).toBe(200);
    expect((await db.query.taskLineTable.findFirst({
      where: (line, { eq }) => eq(line.id, confirmedBody.id),
    }))?.side).toBe("deposit");
  });

  test("catalog suggestions wait for at least three prior uses", async () => {
    const { userId, token } = await makeAuthedUser("suggestions");
    await db.insert(dayTable).values({
      id: "suggestion-day",
      userId,
      date: "2026-07-24",
      startedAt: new Date(),
      openingBalance: 100,
      closingBalance: null,
      phase: "plan",
    });
    await db.insert(taskCatalogTable).values([
      {
        id: "one-off",
        userId,
        side: "deposit",
        labelCiphertext: "cipher-one",
        labelIv: "iv-one",
        labelHash: "one-hash",
        typicalCost: 10,
        weekdayMask: 127,
        useCount: 2,
        difficultyTotal: 0,
        difficultyCount: 0,
        lastUsed: "2026-07-20",
      },
      {
        id: "repeated",
        userId,
        side: "deposit",
        labelCiphertext: "cipher-repeated",
        labelIv: "iv-repeated",
        labelHash: "repeated-hash",
        typicalCost: 10,
        weekdayMask: 127,
        useCount: 3,
        difficultyTotal: 0,
        difficultyCount: 0,
        lastUsed: "2026-07-22",
      },
    ]);
    const response = await apiRequest("/suggestions/suggestion-day", token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { suggestions: Array<{ id: string }> };
    expect(body.suggestions.map((entry) => entry.id)).toEqual(["repeated"]);
  });

  test("batch reorder commits all line positions together and rejects foreign ids", async () => {
    const { userId, token } = await makeAuthedUser("reorder");
    await db.insert(dayTable).values(dayRow("reorder-day", userId, "plan", 0));
    await db.insert(taskLineTable).values([
      { ...lineRow("reorder-a", "reorder-day", "reorder-a"), sort: 0 },
      { ...lineRow("reorder-b", "reorder-day", "reorder-b"), sort: 1 },
    ]);
    const moved = await apiRequest("/days/reorder-day/lines/reorder", token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positions: [
          { id: "reorder-a", side: "withdrawal", sort: 0 },
          { id: "reorder-b", side: "deposit", sort: 0 },
        ],
      }),
    });
    expect(moved.status).toBe(200);
    const movedRows = await db.select().from(taskLineTable).where(eq(taskLineTable.dayId, "reorder-day"));
    expect(movedRows.map((line) => [line.id, line.side, line.sort]).sort()).toEqual([
      ["reorder-a", "withdrawal", 0],
      ["reorder-b", "deposit", 0],
    ]);

    const rejected = await apiRequest("/days/reorder-day/lines/reorder", token, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: [{ id: "missing", side: "deposit", sort: 3 }] }),
    });
    expect(rejected.status).toBe(404);
    const unchanged = await db.query.taskLineTable.findFirst({
      where: (line, { eq }) => eq(line.id, "reorder-a"),
    });
    expect(unchanged?.side).toBe("withdrawal");
    expect(unchanged?.sort).toBe(0);
  });
});

describe("DELETE /api/days/:dayId", () => {
  test("hides days owned by another user", async () => {
    const response = await deleteRequest("closed-day", otherToken);
    expect(response.status).toBe(404);
  });

  test("does not delete the active day", async () => {
    const response = await deleteRequest("active-day", ownerToken);
    expect(response.status).toBe(400);
    expect(await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "active-day"),
    })).toBeTruthy();
  });

  test("deletes a closed day, cascades its lines, and rebuilds activity history", async () => {
    const response = await deleteRequest("closed-day", ownerToken);
    expect(response.status).toBe(200);
    expect(await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "closed-day"),
    })).toBeUndefined();
    expect(await db.query.taskLineTable.findFirst({
      where: (line, { eq }) => eq(line.id, "closed-line"),
    })).toBeUndefined();
    expect(await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.id, "active-day"),
    })).toBeTruthy();
    const catalog = await db.query.taskCatalogTable.findMany({
      where: (entry, { eq }) => eq(entry.userId, "owner"),
    });
    expect(catalog.map((entry) => entry.labelHash)).toEqual(["active-hash"]);
  });
});

describe("corpus restore", () => {
  test("rejects unauthenticated previews and malformed restore payloads", async () => {
    const { userId, token } = await makeAuthedUser("restore-malformed");
    const unauthenticated = await dayRoutes.handle(
      new Request("http://localhost/api/import/corpus/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ days: [], hasProfile: false }),
      }),
    );
    expect(unauthenticated.status).toBe(401);

    const malformed = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...restorePayload("merge"), schemaVersion: 6 }),
    });
    expect(malformed.status).toBeGreaterThanOrEqual(400);
    expect(await db.query.dayTable.findMany({
      where: (day, { eq }) => eq(day.userId, userId),
    })).toHaveLength(0);
  });

  test("replace restores timestamps, profile data, derived catalog, and source ids", async () => {
    const { userId, token } = await makeAuthedUser("restore-replace");
    const sourceDay = restoredDay("replace-day", "closed", [
      restoredLine("replace-add", "deposit"),
      restoredLine("replace-use", "withdrawal"),
    ]);
    const response = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("replace", [sourceDay])),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, daysAdded: 1, linesAdded: 2, profileRestored: true });

    const imported = await db.query.dayTable.findFirst({
      where: (day, { eq }) => eq(day.userId, userId),
    });
    expect(imported?.sourceId).toBe("replace-day");
    expect(imported?.startedAt.toISOString()).toBe(sourceDay.startedAt);
    expect(imported?.closedAt?.toISOString()).toBe(sourceDay.closedAt);
    expect(imported?.closingBalance).toBe(120);
    const lines = await db.query.taskLineTable.findMany({
      where: (line, { eq }) => eq(line.dayId, imported!.id),
    });
    expect(lines.map((line) => line.sourceId).sort()).toEqual(["replace-add", "replace-use"]);
    expect(lines.every((line) => line.completedAt?.toISOString() === "2026-07-01T17:00:00.000Z")).toBe(true);
    const profile = await db.query.youProfileTable.findFirst({
      where: (row, { eq }) => eq(row.userId, userId),
    });
    expect(profile?.updatedAt.toISOString()).toBe("2026-07-01T19:00:00.000Z");
    const user = await db.query.userTable.findFirst({ where: (row, { eq }) => eq(row.id, userId) });
    expect(user?.displayName).toBe("Imported person");
    expect(user?.includePhysicalActivities).toBe(false);
    const catalog = await db.query.taskCatalogTable.findMany({
      where: (entry, { eq }) => eq(entry.userId, userId),
    });
    expect(catalog).toHaveLength(2);

    const exported = await apiRequest("/export/days", token);
    const exportedJson = (await exported.json()) as { schemaVersion: number; days: Array<{ sourceId: string }> };
    expect(exportedJson.schemaVersion).toBe(7);
    expect(exportedJson.days[0]?.sourceId).toBe("replace-day");
  });

  test("merge is idempotent and adds only new lines inside an existing day", async () => {
    const { userId, token } = await makeAuthedUser("restore-merge");
    const source = restoredDay("merge-day", "closed", [restoredLine("merge-first")]);
    const first = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [source])),
    });
    expect(first.status).toBe(200);

    const repeated = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [source])),
    });
    expect(await repeated.json()).toMatchObject({ daysAdded: 0, daysExisting: 1, linesAdded: 0, linesExisting: 1 });

    const withExtraLine = restoredDay("merge-day", "closed", [
      restoredLine("merge-first"),
      restoredLine("merge-second", "withdrawal"),
    ]);
    const partial = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [withExtraLine])),
    });
    expect(await partial.json()).toMatchObject({ daysAdded: 0, daysExisting: 1, linesAdded: 1, linesExisting: 1 });
    const day = await db.query.dayTable.findFirst({
      where: (row, { and, eq }) => and(eq(row.userId, userId), eq(row.sourceId, "merge-day")),
    });
    const lines = await db.query.taskLineTable.findMany({
      where: (line, { eq }) => eq(line.dayId, day!.id),
    });
    expect(lines).toHaveLength(2);
    expect(day?.closingBalance).toBe(120);
  });

  test("merge makes an explicit choice when source and destination both have active days", async () => {
    const { userId, token } = await makeAuthedUser("restore-active");
    await db.insert(dayTable).values(dayRow("destination-active", userId, "plan", -1));
    const incoming = restoredDay("source-active", "plan");

    const preview = await apiRequest("/import/corpus/preview", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        days: [{ sourceId: incoming.sourceId, phase: incoming.phase, lineSourceIds: incoming.lines.map((line) => line.sourceId) }],
        hasProfile: true,
      }),
    });
    expect((await preview.json() as { activeDayConflict: boolean }).activeDayConflict).toBe(true);

    const needsChoice = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [incoming])),
    });
    expect(needsChoice.status).toBe(409);

    const keep = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [incoming], { activeDayResolution: "keep-current" })),
    });
    expect(await keep.json()).toMatchObject({ daysSkippedForActiveConflict: 1 });
    expect((await db.query.dayTable.findFirst({ where: (row, { eq }) => eq(row.id, "destination-active") }))?.phase).toBe("plan");

    const replace = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("merge", [incoming], { activeDayResolution: "replace-current" })),
    });
    expect(replace.status).toBe(200);
    const active = await db.query.dayTable.findFirst({
      where: (row, { and, eq, ne }) => and(eq(row.userId, userId), ne(row.phase, "closed")),
    });
    expect(active?.sourceId).toBe("source-active");
  });

  test("an invalid restored timestamp rolls back without adding partial data", async () => {
    const { userId, token } = await makeAuthedUser("restore-atomic");
    const invalid = restoredDay("bad-day");
    invalid.startedAt = "not-a-date";
    const response = await apiRequest("/import/corpus", token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(restorePayload("replace", [invalid])),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.query.dayTable.findMany({
      where: (day, { eq }) => eq(day.userId, userId),
    })).toHaveLength(0);
    expect(await db.query.youProfileTable.findFirst({
      where: (profile, { eq }) => eq(profile.userId, userId),
    })).toBeUndefined();
  });
});

test("legacy migration rejects conflicting active days without rewriting history", async () => {
  const legacyDir = mkdtempSync(join(tmpdir(), "eaj-legacy-test-"));
  const legacy = new Database(join(legacyDir, "eaj.sqlite"), { create: true });
  legacy.exec(`
    CREATE TABLE day_table (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
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
    CREATE TABLE task_line_table (
      id TEXT PRIMARY KEY,
      day_id TEXT NOT NULL,
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
    INSERT INTO day_table (id, user_id, date, opening_balance, phase, is_holiday)
      VALUES ('older', 'legacy-user', '2026-07-20', 80, 'audit', 0);
    INSERT INTO day_table (id, user_id, date, opening_balance, phase, is_holiday)
      VALUES ('newer', 'legacy-user', '2026-07-21', 60, 'plan', 0);
    INSERT INTO task_line_table
      (id, day_id, side, label_ciphertext, label_iv, planned_cost, actual_cost)
      VALUES ('add', 'older', 'deposit', 'x', 'x', 20, 20);
    INSERT INTO task_line_table
      (id, day_id, side, label_ciphertext, label_iv, planned_cost, actual_cost)
      VALUES ('take', 'older', 'withdrawal', 'x', 'x', 50, 50);
  `);
  legacy.close();

  const child = Bun.spawn(
    [process.execPath, "./apps/server/src/db/migrate.ts"],
    {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, DATA_DIR: legacyDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await child.exited;
  expect(exitCode).not.toBe(0);

  const migrated = new Database(join(legacyDir, "eaj.sqlite"));
  const older = migrated
    .query("SELECT opening_balance, closing_balance, phase FROM day_table WHERE id = 'older'")
    .get() as { opening_balance: number; closing_balance: number | null; phase: string };
  const newer = migrated
    .query("SELECT opening_balance, closing_balance, phase FROM day_table WHERE id = 'newer'")
    .get() as { opening_balance: number; closing_balance: number | null; phase: string };
  expect(older).toEqual({ opening_balance: 80, closing_balance: null, phase: "audit" });
  expect(newer).toEqual({
    opening_balance: 60,
    closing_balance: null,
    phase: "plan",
  });
  migrated.close();
  rmSync(legacyDir, { recursive: true, force: true });
});
