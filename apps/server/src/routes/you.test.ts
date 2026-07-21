import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

// The db module resolves DATA_DIR at import time, so point it at a throwaway
// directory before anything pulls it in (dynamic imports keep the ordering).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "eaj-you-test-"));

const { db } = await import("../db/index.ts");
const {
  dayTable,
  sessionTable,
  shareSnapshotTable,
  taskLineTable,
  userTable,
  youProfileTable,
} = await import("../db/schema.ts");
const { youRoutes } = await import("./you.ts");
const { authRoutes } = await import("./auth.ts");
const { SESSION_COOKIE, hashToken, newId } = await import("../lib/session.ts");

const PASSWORD = "correct horse battery";

async function makeUser(prefix: string): Promise<{ userId: string; cookie: string }> {
  const userId = newId();
  // The db module is cached across test files in one bun run, so emails must
  // be globally unique to dodge the user_table email constraint.
  const email = `${prefix}-${userId.slice(0, 8)}@example.com`;
  await db.insert(userTable).values({
    id: userId,
    email,
    passwordHash: await Bun.password.hash(PASSWORD, {
      algorithm: "argon2id",
      memoryCost: 19456,
      timeCost: 2,
    }),
    kekSalt: "salt",
    wrappedDek: "wrapped",
    timezone: "UTC",
    createdAt: new Date(),
  });
  const token = randomBytes(32).toString("hex");
  await db.insert(sessionTable).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 60_000),
    pendingTotp: false,
  });
  return { userId, cookie: `${SESSION_COOKIE}=${token}` };
}

function req(
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

describe("you profile blob", () => {
  test("requires auth", async () => {
    const res = await youRoutes.handle(req("/api/you/profile"));
    expect(res.status).toBe(401);
  });

  test("stores and returns the opaque blob, upserting on rewrite", async () => {
    const { cookie } = await makeUser("blob");
    const empty = await youRoutes.handle(req("/api/you/profile", { cookie }));
    expect(((await empty.json()) as { profile: unknown }).profile).toBeNull();

    const put1 = await youRoutes.handle(
      req("/api/you/profile", {
        method: "PUT",
        cookie,
        body: { ciphertext: "ct-1", iv: "AAAAAAAAAAAAAAAA" },
      }),
    );
    expect(put1.status).toBe(200);
    await youRoutes.handle(
      req("/api/you/profile", {
        method: "PUT",
        cookie,
        body: { ciphertext: "ct-2", iv: "BBBBBBBBBBBBBBBB" },
      }),
    );
    const got = await youRoutes.handle(req("/api/you/profile", { cookie }));
    const data = (await got.json()) as { profile: { ciphertext: string; iv: string } };
    expect(data.profile.ciphertext).toBe("ct-2");
    expect(data.profile.iv).toBe("BBBBBBBBBBBBBBBB");
  });
});

describe("share snapshots", () => {
  test("create returns a token once and the public page resolves it", async () => {
    const { cookie } = await makeUser("share");
    const payload = JSON.stringify({ version: 1, name: "A", identity: {} });
    const created = await youRoutes.handle(
      req("/api/you/shares", { method: "POST", cookie, body: { payload, ttl: "day" } }),
    );
    expect(created.status).toBe(201);
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string; revoked: boolean };
    };
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(share.revoked).toBe(false);

    // Public resolution needs no cookie.
    const publicRes = await youRoutes.handle(req(`/api/share/${token}`));
    expect(publicRes.status).toBe(200);
    const body = (await publicRes.json()) as { payload: { name: string } };
    expect(body.payload.name).toBe("A");

    // Stored row keeps only the hash of the token.
    const row = await db.query.shareSnapshotTable.findFirst({
      where: eq(shareSnapshotTable.id, share.id),
    });
    expect(row?.tokenHash).not.toBe(token);
  });

  test("permanent links survive expiry scrubbing until revoked", async () => {
    const { cookie } = await makeUser("permanent");
    const payload = JSON.stringify({ version: 1, name: "Always available" });
    const created = await youRoutes.handle(
      req("/api/you/shares", { method: "POST", cookie, body: { payload, ttl: "permanent" } }),
    );
    expect(created.status).toBe(201);
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string; expiresAt: string | null };
    };
    expect(share.expiresAt).toBeNull();

    // Permanent status, rather than the compatibility expiry value, controls cleanup.
    await db
      .update(shareSnapshotTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(shareSnapshotTable.id, share.id));
    const listed = await youRoutes.handle(req("/api/you/shares", { cookie }));
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as {
      shares: Array<{ id: string; expiresAt: string | null; revoked: boolean }>;
    };
    expect(listedBody.shares).toHaveLength(1);
    expect(listedBody.shares[0]).toMatchObject({
      id: share.id,
      expiresAt: null,
      revoked: false,
    });
    const publicRes = await youRoutes.handle(req(`/api/share/${token}`));
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as {
      expiresAt: string | null;
      payload: { name: string };
    };
    expect(publicBody.expiresAt).toBeNull();
    expect(publicBody.payload.name).toBe("Always available");

    const revoked = await youRoutes.handle(
      req(`/api/you/shares/${share.id}`, { method: "DELETE", cookie }),
    );
    expect(revoked.status).toBe(200);
    expect((await youRoutes.handle(req(`/api/share/${token}`))).status).toBe(404);
    // Revoked permanent rows become scrubbable empty tombstones.
    const afterList = await youRoutes.handle(req("/api/you/shares", { cookie }));
    expect(
      ((await afterList.json()) as { shares: unknown[] }).shares,
    ).toHaveLength(0);
    expect(
      await db.query.shareSnapshotTable.findFirst({ where: eq(shareSnapshotTable.id, share.id) }),
    ).toBeUndefined();
  });

  test("revocation kills the link and clears the payload", async () => {
    const { cookie } = await makeUser("revoke");
    const payload = JSON.stringify({ version: 1, secret: "sensitive words" });
    const created = await youRoutes.handle(
      req("/api/you/shares", { method: "POST", cookie, body: { payload, ttl: "month" } }),
    );
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string };
    };
    const del = await youRoutes.handle(
      req(`/api/you/shares/${share.id}`, { method: "DELETE", cookie }),
    );
    expect(del.status).toBe(200);
    const publicRes = await youRoutes.handle(req(`/api/share/${token}`));
    expect(publicRes.status).toBe(404);
    const row = await db.query.shareSnapshotTable.findFirst({
      where: eq(shareSnapshotTable.id, share.id),
    });
    expect(row?.payload).toBe("{}");
  });

  test("cannot revoke someone else's share", async () => {
    const owner = await makeUser("owner");
    const outsider = await makeUser("outsider");
    const created = await youRoutes.handle(
      req("/api/you/shares", {
        method: "POST",
        cookie: owner.cookie,
        body: { payload: "{}", ttl: "day" },
      }),
    );
    const { share } = (await created.json()) as { share: { id: string } };
    const res = await youRoutes.handle(
      req(`/api/you/shares/${share.id}`, { method: "DELETE", cookie: outsider.cookie }),
    );
    expect(res.status).toBe(404);
  });

  test("expired links 404 and are scrubbed so the payload does not linger", async () => {
    const { userId } = await makeUser("expired");
    const token = randomBytes(32).toString("base64url");
    const id = newId();
    await db.insert(shareSnapshotTable).values({
      id,
      userId,
      tokenHash: hashToken(token),
      payload: JSON.stringify({ secret: "should-not-linger" }),
      createdAt: new Date(Date.now() - 100_000),
      expiresAt: new Date(Date.now() - 120_000),
      revokedAt: null,
    });
    const res = await youRoutes.handle(req(`/api/share/${token}`));
    expect(res.status).toBe(404);
    expect(
      await db.query.shareSnapshotTable.findFirst({ where: eq(shareSnapshotTable.id, id) }),
    ).toBeUndefined();
  });

  test("creating a share scrubs expired rows before enforcing the live limit", async () => {
    const { userId, cookie } = await makeUser("cap");
    await db.insert(shareSnapshotTable).values({
      id: newId(),
      userId,
      tokenHash: hashToken(randomBytes(32).toString("base64url")),
      payload: JSON.stringify({ leftover: true }),
      createdAt: new Date(Date.now() - 100_000),
      expiresAt: new Date(Date.now() - 120_000),
      revokedAt: null,
    });
    const created = await youRoutes.handle(
      req("/api/you/shares", {
        method: "POST",
        cookie,
        body: { payload: "{}", ttl: "day" },
      }),
    );
    expect(created.status).toBe(201);
    const remaining = await db
      .select()
      .from(shareSnapshotTable)
      .where(eq(shareSnapshotTable.userId, userId));
    expect(remaining.length).toBe(1);
    expect(remaining[0]!.payload).toBe("{}");
  });

  test("junk payloads are rejected", async () => {
    const { cookie } = await makeUser("junk");
    const res = await youRoutes.handle(
      req("/api/you/shares", {
        method: "POST",
        cookie,
        body: { payload: "not json", ttl: "day" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("account deletion", () => {
  async function seedFullAccount(email: string) {
    const { userId, cookie } = await makeUser(email);
    const dayId = newId();
    await db.insert(dayTable).values({
      id: dayId,
      userId,
      date: "2026-07-20",
      startedAt: new Date(),
      openingBalance: 100,
      phase: "closed",
      closingBalance: 90,
    });
    await db.insert(taskLineTable).values({
      id: newId(),
      dayId,
      side: "withdrawal",
      sort: 0,
      labelCiphertext: "ct",
      labelIv: "iv",
      labelHash: "h",
      plannedCost: 10,
    });
    await db.insert(youProfileTable).values({
      userId,
      ciphertext: "ct",
      iv: "iv",
      updatedAt: new Date(),
    });
    await db.insert(shareSnapshotTable).values({
      id: newId(),
      userId,
      tokenHash: hashToken(randomBytes(32).toString("base64url")),
      payload: "{}",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    return { userId, cookie, dayId };
  }

  function deleteReq(cookie: string, body: unknown): Request {
    return new Request("http://localhost/api/auth/delete-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  }

  test("wrong password deletes nothing", async () => {
    const { cookie, userId } = await seedFullAccount("del-wrong");
    const res = await authRoutes.handle(deleteReq(cookie, { password: "nope", confirm: "DELETE" }));
    expect(res.status).toBe(401);
    expect(
      await db.query.userTable.findFirst({ where: eq(userTable.id, userId) }),
    ).toBeDefined();
  });

  test("missing typed confirmation deletes nothing", async () => {
    const { cookie, userId } = await seedFullAccount("del-noconfirm");
    const res = await authRoutes.handle(
      deleteReq(cookie, { password: PASSWORD, confirm: "delete" }),
    );
    expect(res.status).toBe(400);
    expect(
      await db.query.userTable.findFirst({ where: eq(userTable.id, userId) }),
    ).toBeDefined();
  });

  test("verified deletion cascades through every table", async () => {
    const { cookie, userId, dayId } = await seedFullAccount("del-full");
    const res = await authRoutes.handle(
      deleteReq(cookie, { password: PASSWORD, confirm: "DELETE" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    expect(
      await db.query.userTable.findFirst({ where: eq(userTable.id, userId) }),
    ).toBeUndefined();
    expect(
      await db.query.dayTable.findFirst({ where: eq(dayTable.userId, userId) }),
    ).toBeUndefined();
    expect(
      await db.query.taskLineTable.findFirst({ where: eq(taskLineTable.dayId, dayId) }),
    ).toBeUndefined();
    expect(
      await db.query.youProfileTable.findFirst({ where: eq(youProfileTable.userId, userId) }),
    ).toBeUndefined();
    expect(
      await db.query.shareSnapshotTable.findFirst({
        where: eq(shareSnapshotTable.userId, userId),
      }),
    ).toBeUndefined();
    expect(
      await db.query.sessionTable.findFirst({ where: eq(sessionTable.userId, userId) }),
    ).toBeUndefined();
  });
});
