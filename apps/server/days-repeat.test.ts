import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "eaj-repeat-test-"));
process.env.DATA_DIR = dataDir;
// bun test shares one process (and thus one sqlite handle) across files, so
// removing the data dir in afterAll would corrupt later test files that reuse
// the cached db module. Clean up only when the whole run exits.
process.on("exit", () => rmSync(dataDir, { recursive: true, force: true }));

const [{ dayRoutes }, { db }, schema, session] = await Promise.all([
  import("./src/routes/days.ts"),
  import("./src/db/index.ts"),
  import("./src/db/schema.ts"),
  import("./src/lib/session.ts"),
]);

const { dayTable, taskCatalogTable, taskLineTable, userTable } = schema;
const { createSession } = session;

const NOW = Date.now();

function userRow(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    passwordHash: "unused",
    kekSalt: "salt",
    wrappedDek: "wrapped",
    timezone: "UTC",
    onboardingCompleted: true,
    locationPrompted: true,
    createdAt: new Date(),
  };
}

function dayRow(
  id: string,
  userId: string,
  phase: "plan" | "audit" | "closed",
  minutesAgo: number,
  date = "2026-07-21",
) {
  return {
    id,
    userId,
    date,
    startedAt: new Date(NOW - minutesAgo * 60_000),
    openingBalance: 100,
    closingBalance: phase === "closed" ? 100 : null,
    phase,
  };
}

function lineRow(
  id: string,
  dayId: string,
  overrides: Partial<typeof taskLineTable.$inferInsert> = {},
) {
  return {
    id,
    dayId,
    side: "deposit",
    sort: 0,
    labelCiphertext: `cipher-${id}`,
    labelIv: `iv-${id}`,
    labelHash: `hash-${id}`,
    plannedCost: 20,
    actualCost: 20,
    completed: true,
    difficulty: 7,
    detailsCiphertext: `details-${id}`,
    detailsIv: `details-iv-${id}`,
    ...overrides,
  };
}

const tokens = new Map<string, string>();

function apiRequest(path: string, userId: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `eaj_session=${tokens.get(userId)}`);
  return dayRoutes.handle(new Request(`http://localhost/api${path}`, { ...init, headers }));
}

function repeatRequest(dayId: string, userId: string) {
  return apiRequest(`/days/${dayId}/repeat-previous`, userId, { method: "POST" });
}

beforeAll(async () => {
  // Each test scenario owns its own user + ledgers so mutating tests
  // (copy, duplicate submit, start) cannot affect the read-only ones.
  const users = [
    "repeater",
    "capped",
    "fresh",
    "busy",
    "recenter",
    "outsider",
    "doubler",
    "lifecycle",
    "avail",
    "starter",
  ];
  await db.insert(userTable).values(users.map(userRow));
  for (const u of users) {
    tokens.set(u, (await createSession(u, false)).token);
  }

  await db.insert(dayTable).values([
    // repeater: an old closed ledger, two closed ledgers tied on startedAt
    // (same calendar date), an empty newest closed ledger, and a
    // midnight-spanning active day whose date differs from startedAt's date.
    dayRow("oldest", "repeater", "closed", 300, "2026-07-20"),
    dayRow("a-tie", "repeater", "closed", 120, "2026-07-21"),
    dayRow("b-tie", "repeater", "closed", 120, "2026-07-21"),
    dayRow("empty-closed", "repeater", "closed", 60, "2026-07-21"),
    dayRow("repeat-target", "repeater", "plan", 10, "2026-07-22"),
    // capped: previous plan too large for a fresh 100-point day
    dayRow("capped-source", "capped", "closed", 60),
    dayRow("capped-target", "capped", "plan", 10),
    // fresh: planning day with no prior closed ledger
    dayRow("fresh-target", "fresh", "plan", 10),
    // busy: planning day that already has a task
    dayRow("busy-source", "busy", "closed", 60),
    dayRow("busy-target", "busy", "plan", 10),
    // recenter: two closed ledgers of history plus an active day
    dayRow("recent-old", "recenter", "closed", 120, "2026-07-20"),
    dayRow("recent-new", "recenter", "closed", 60, "2026-07-21"),
    dayRow("recent-target", "recenter", "plan", 10, "2026-07-21"),
    // doubler: isolated fixture for duplicate-submit protection
    dayRow("double-source", "doubler", "closed", 60),
    dayRow("double-target", "doubler", "plan", 10),
    // lifecycle: calendar yesterday differs from lifecycle previous; the
    // ledger with the newer startedAt wins even though its date is older.
    dayRow("cal-yesterday", "lifecycle", "closed", 240, "2026-07-20"),
    dayRow("started-later", "lifecycle", "closed", 90, "2026-07-18"),
    dayRow("lifecycle-target", "lifecycle", "plan", 10, "2026-07-21"),
    // avail: read-only positive case for availability metadata
    dayRow("avail-source", "avail", "closed", 60),
    dayRow("avail-target", "avail", "plan", 10),
    // starter: closed history and no active day, for POST /days/start
    dayRow("starter-history", "starter", "closed", 60, "2026-07-20"),
  ]);

  await db.insert(taskLineTable).values([
    lineRow("oldest-line", "oldest"),
    lineRow("a-line", "a-tie"),
    // b-tie wins the startedAt tie via id ordering; its lines are the source.
    lineRow("walk", "b-tie", { side: "deposit", sort: 0, plannedCost: 15 }),
    lineRow("chores", "b-tie", { side: "withdrawal", sort: 1, plannedCost: 25 }),
    lineRow("too-big-1", "capped-source", { plannedCost: 60 }),
    lineRow("too-big-2", "capped-source", { sort: 1, plannedCost: 70 }),
    lineRow("busy-source-line", "busy-source"),
    lineRow("busy-existing", "busy-target", { completed: false, actualCost: null }),
    // recenter history: dup-dep appears in both ledgers with different costs,
    // on-day-hash is already on the active day, and six deposits test the cap.
    lineRow("old-dep", "recent-old", { side: "deposit", labelHash: "dup-dep", plannedCost: 10 }),
    lineRow("old-wd", "recent-old", { side: "withdrawal", sort: 1, labelHash: "old-wd-hash" }),
    lineRow("new-dup", "recent-new", { side: "deposit", labelHash: "dup-dep", plannedCost: 30 }),
    lineRow("new-on-day", "recent-new", { sort: 1, labelHash: "on-day-hash" }),
    lineRow("new-d1", "recent-new", { sort: 2, labelHash: "d1" }),
    lineRow("new-d2", "recent-new", { sort: 3, labelHash: "d2" }),
    lineRow("new-d3", "recent-new", { sort: 4, labelHash: "d3" }),
    lineRow("new-d4", "recent-new", { sort: 5, labelHash: "d4" }),
    lineRow("new-d5", "recent-new", { sort: 6, labelHash: "d5" }),
    // Same label hash as the on-day deposit but on the other side: exclusion
    // is side-scoped, so this one must still be offered.
    lineRow("new-on-day-wd", "recent-new", {
      side: "withdrawal",
      sort: 7,
      labelHash: "on-day-hash",
    }),
    lineRow("target-line", "recent-target", {
      labelHash: "on-day-hash",
      completed: false,
      actualCost: null,
    }),
    lineRow("double-line", "double-source"),
    lineRow("cal-line", "cal-yesterday"),
    lineRow("later-line", "started-later", { plannedCost: 35 }),
    lineRow("avail-line", "avail-source"),
    lineRow("starter-line", "starter-history"),
  ]);

  // Pre-seeded catalog stats for a repeated activity: the copy test asserts
  // repeat-previous leaves these untouched (no useCount/ranking inflation).
  await db.insert(taskCatalogTable).values({
    id: "walk-catalog",
    userId: "repeater",
    side: "deposit",
    labelCiphertext: "cipher-walk",
    labelIv: "iv-walk",
    labelHash: "hash-walk",
    typicalCost: 15,
    weekdayMask: 1,
    useCount: 3,
    difficultyTotal: 0,
    difficultyCount: 0,
    lastUsed: "2026-07-21",
  });
});

describe("POST /api/days/:dayId/repeat-previous", () => {
  test("rejects a planning day with no prior closed ledger", async () => {
    const res = await repeatRequest("fresh-target", "fresh");
    expect(res.status).toBe(400);
  });

  test("hides days owned by another user", async () => {
    const res = await repeatRequest("repeat-target", "outsider");
    expect(res.status).toBe(404);
  });

  test("rejects a closed target", async () => {
    const res = await repeatRequest("busy-source", "busy");
    expect(res.status).toBe(400);
  });

  test("rejects a nonempty target without touching its lines", async () => {
    const res = await repeatRequest("busy-target", "busy");
    expect(res.status).toBe(409);
    const lines = await db.query.taskLineTable.findMany({
      where: (line, { eq }) => eq(line.dayId, "busy-target"),
    });
    expect(lines.map((l) => l.id)).toEqual(["busy-existing"]);
  });

  test("rejects the whole copy when the previous plan exceeds capacity", async () => {
    const res = await repeatRequest("capped-target", "capped");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("130");
    expect(
      await db.query.taskLineTable.findMany({
        where: (line, { eq }) => eq(line.dayId, "capped-target"),
      }),
    ).toHaveLength(0);
  });

  test("availability metadata reflects the empty planning day and its history", async () => {
    const active = await apiRequest("/days/active", "avail");
    expect(active.status).toBe(200);
    const { day } = (await active.json()) as { day: { id: string; repeatAvailable: boolean } };
    expect(day.id).toBe("avail-target");
    expect(day.repeatAvailable).toBe(true);

    const noHistory = (await (await apiRequest("/days/active", "fresh")).json()) as {
      day: { repeatAvailable: boolean };
    };
    expect(noHistory.day.repeatAvailable).toBe(false);

    const nonempty = (await (await apiRequest("/days/active", "busy")).json()) as {
      day: { repeatAvailable: boolean };
    };
    expect(nonempty.day.repeatAvailable).toBe(false);
  });

  test("GET /days/:dayId reports the same availability as the active view", async () => {
    // This is the path the web app loads right after Start new day.
    const res = await apiRequest("/days/avail-target", "avail");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repeatAvailable: boolean };
    expect(body.repeatAvailable).toBe(true);

    const closed = (await (await apiRequest("/days/avail-source", "avail")).json()) as {
      repeatAvailable: boolean;
    };
    expect(closed.repeatAvailable).toBe(false);
  });

  test("POST /days/start reports availability on the freshly created day", async () => {
    const res = await apiRequest("/days/start", "starter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: "2026-07-21" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { repeatAvailable: boolean };
    expect(body.repeatAvailable).toBe(true);
  });

  test("copies the most recent nonempty closed ledger (startedAt, then id) and resets per-day fields", async () => {
    const res = await repeatRequest("repeat-target", "repeater");
    expect(res.status).toBe(200);
    const { day } = (await res.json()) as {
      day: { repeatAvailable: boolean; lines: { labelHash: string }[] };
    };
    expect(day.repeatAvailable).toBe(false);

    // Skipped the empty newest closed ledger; among the startedAt tie, id
    // ordering picks b-tie, not a-tie or the older ledgers.
    const copied = await db.query.taskLineTable.findMany({
      where: (line, { eq }) => eq(line.dayId, "repeat-target"),
      orderBy: (line, { asc }) => asc(line.sort),
    });
    expect(copied.map((l) => l.labelHash)).toEqual(["hash-walk", "hash-chores"]);
    expect(copied.map((l) => l.side)).toEqual(["deposit", "withdrawal"]);
    expect(copied.map((l) => l.sort)).toEqual([0, 1]);
    expect(copied.map((l) => l.plannedCost)).toEqual([15, 25]);
    expect(copied[0]?.labelCiphertext).toBe("cipher-walk");
    expect(copied[0]?.labelIv).toBe("iv-walk");
    for (const line of copied) {
      expect(line.completed).toBe(false);
      expect(line.actualCost).toBeNull();
      expect(line.difficulty).toBeNull();
      expect(line.detailsCiphertext).toBeNull();
      expect(line.detailsIv).toBeNull();
    }

    // Repeat remembers the plan but does not game the catalog ranking: the
    // pre-seeded stats stay exactly as they were, and nothing new is created.
    const catalog = await db.query.taskCatalogTable.findMany({
      where: (entry, { eq }) => eq(entry.userId, "repeater"),
    });
    const walk = catalog.find((c) => c.labelHash === "hash-walk");
    expect(walk?.useCount).toBe(3);
    expect(walk?.lastUsed).toBe("2026-07-21");
    expect(catalog.find((c) => c.labelHash === "hash-chores")).toBeUndefined();
  });

  test("copies the lifecycle-previous ledger even when calendar yesterday differs", async () => {
    const res = await repeatRequest("lifecycle-target", "lifecycle");
    expect(res.status).toBe(200);
    const copied = await db.query.taskLineTable.findMany({
      where: (line, { eq }) => eq(line.dayId, "lifecycle-target"),
    });
    // The ledger dated 2026-07-18 started more recently than the one dated
    // calendar-yesterday, so lifecycle order (startedAt) picks it.
    expect(copied.map((l) => l.labelHash)).toEqual(["hash-later-line"]);
    expect(copied[0]?.plannedCost).toBe(35);
  });

  test("a duplicate submit after success is rejected and copies nothing twice", async () => {
    const first = await repeatRequest("double-target", "doubler");
    expect(first.status).toBe(200);
    const second = await repeatRequest("double-target", "doubler");
    expect(second.status).toBe(409);
    expect(
      await db.query.taskLineTable.findMany({
        where: (line, { eq }) => eq(line.dayId, "double-target"),
      }),
    ).toHaveLength(1);
  });
});

describe("GET /api/suggestions/:dayId recent collection", () => {
  test("returns prior-ledger recents, newest first, deduplicated, capped, and excluding on-day labels", async () => {
    const res = await apiRequest("/suggestions/recent-target", "recenter");
    expect(res.status).toBe(200);
    const { recent } = (await res.json()) as {
      recent: { side: string; labelHash: string; typicalCost: number; lastUsed: string }[];
    };

    const deposits = recent.filter((r) => r.side === "deposit");
    const withdrawals = recent.filter((r) => r.side === "withdrawal");

    // Capped at five deposits even though six unique ones exist in history.
    expect(deposits).toHaveLength(5);
    // Newest ledger wins the duplicate and supplies its planned cost.
    expect(deposits[0]?.labelHash).toBe("dup-dep");
    expect(deposits[0]?.typicalCost).toBe(30);
    expect(deposits[0]?.lastUsed).toBe("2026-07-21");
    // The deposit label already on the active day never appears as a deposit,
    // but the same hash on the other side is offered: exclusion is side-scoped.
    expect(deposits.some((r) => r.labelHash === "on-day-hash")).toBe(false);
    expect(withdrawals.map((r) => r.labelHash)).toEqual(["on-day-hash", "old-wd-hash"]);
  });
});
