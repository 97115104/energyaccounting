import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "eaj-days-test-"));
process.env.DATA_DIR = dataDir;

const [{ dayRoutes }, { db }, schema, session] = await Promise.all([
  import("./src/routes/days.ts"),
  import("./src/db/index.ts"),
  import("./src/db/schema.ts"),
  import("./src/lib/session.ts"),
]);

const { dayTable, taskCatalogTable, taskLineTable, userTable } = schema;
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

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
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

test("legacy migration closes duplicate open days with balances computed from their lines", async () => {
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
    [process.execPath, "-e", "await import('./apps/server/src/db/index.ts')"],
    {
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, DATA_DIR: legacyDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const exitCode = await child.exited;
  expect(exitCode).toBe(0);

  const migrated = new Database(join(legacyDir, "eaj.sqlite"));
  const older = migrated
    .query("SELECT opening_balance, closing_balance, phase FROM day_table WHERE id = 'older'")
    .get() as { opening_balance: number; closing_balance: number; phase: string };
  const newer = migrated
    .query("SELECT opening_balance, closing_balance, phase FROM day_table WHERE id = 'newer'")
    .get() as { opening_balance: number; closing_balance: number | null; phase: string };
  expect(older).toEqual({ opening_balance: 100, closing_balance: 70, phase: "closed" });
  expect(newer).toEqual({ opening_balance: 100, closing_balance: null, phase: "plan" });
  migrated.close();
  rmSync(legacyDir, { recursive: true, force: true });
});
