import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "../db/index.ts";
import { shareSnapshotTable, youProfileTable } from "../db/schema.ts";
import { hashToken, newId, requireFullUser } from "../lib/session.ts";

/**
 * You profile and share snapshot routes.
 *
 * The profile endpoint stores one opaque AES-GCM blob per user; the server
 * never sees plaintext. Share snapshots are the deliberate exception: the
 * client sends already-chosen plaintext sections, frozen under an unguessable
 * token so the person can revoke or let them expire.
 */

const SHARE_TTLS_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  quarter: 90 * 24 * 60 * 60 * 1000,
};

const MAX_SNAPSHOTS_PER_USER = 20;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PROFILE_BYTES = 256 * 1024;
/** AES-GCM IV is 12 bytes → 16 chars of standard base64; allow a little slack. */
const MAX_IV_CHARS = 64;

function serializeSnapshot(row: typeof shareSnapshotTable.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revoked: row.revokedAt != null,
  };
}

/** Hard-delete expired rows so forgotten plaintext cannot accumulate. */
async function scrubExpiredShares(userId: string) {
  await db
    .delete(shareSnapshotTable)
    .where(
      and(eq(shareSnapshotTable.userId, userId), lt(shareSnapshotTable.expiresAt, new Date())),
    );
}

export const youRoutes = new Elysia({ prefix: "/api" })
  .get("/you/profile", async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const row = await db.query.youProfileTable.findFirst({
      where: eq(youProfileTable.userId, user.id),
    });
    if (!row) return { profile: null };
    return {
      profile: {
        ciphertext: row.ciphertext,
        iv: row.iv,
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  })
  .put(
    "/you/profile",
    async ({ body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (body.ciphertext.length > MAX_PROFILE_BYTES) {
        set.status = 400;
        return { error: "Profile is too large to save." };
      }
      if (body.iv.length > MAX_IV_CHARS || body.iv.length < 8) {
        set.status = 400;
        return { error: "Invalid encryption IV." };
      }
      const now = new Date();
      await db
        .insert(youProfileTable)
        .values({ userId: user.id, ciphertext: body.ciphertext, iv: body.iv, updatedAt: now })
        .onConflictDoUpdate({
          target: youProfileTable.userId,
          set: { ciphertext: body.ciphertext, iv: body.iv, updatedAt: now },
        });
      return { ok: true, updatedAt: now.toISOString() };
    },
    { body: t.Object({ ciphertext: t.String(), iv: t.String() }) },
  )
  .get("/you/shares", async ({ request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    await scrubExpiredShares(user.id);
    const rows = await db
      .select()
      .from(shareSnapshotTable)
      .where(eq(shareSnapshotTable.userId, user.id))
      .orderBy(shareSnapshotTable.createdAt);
    return { shares: rows.map(serializeSnapshot) };
  })
  .post(
    "/you/shares",
    async ({ body, request, set }) => {
      const user = await requireFullUser(request);
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (body.payload.length > MAX_PAYLOAD_BYTES) {
        set.status = 400;
        return { error: "Share payload is too large." };
      }
      try {
        const parsed = JSON.parse(body.payload) as unknown;
        if (!parsed || typeof parsed !== "object") throw new Error("not-object");
      } catch {
        set.status = 400;
        return { error: "Share payload must be a JSON object." };
      }
      // Drop expired plaintext before counting so the limit cannot be bypassed
      // by waiting for old shares to age out while their payloads linger.
      await scrubExpiredShares(user.id);
      const existing = await db
        .select()
        .from(shareSnapshotTable)
        .where(eq(shareSnapshotTable.userId, user.id));
      const live = existing.filter((s) => s.revokedAt == null);
      if (live.length >= MAX_SNAPSHOTS_PER_USER) {
        set.status = 400;
        return { error: "Share limit reached. Revoke an older link first." };
      }
      const ttl = SHARE_TTLS_MS[body.ttl] ?? SHARE_TTLS_MS.month!;
      const token = randomBytes(32).toString("base64url");
      const now = new Date();
      const row = {
        id: newId(),
        userId: user.id,
        tokenHash: hashToken(token),
        payload: body.payload,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttl),
        revokedAt: null,
      };
      await db.insert(shareSnapshotTable).values(row);
      set.status = 201;
      return { token, share: serializeSnapshot({ ...row, revokedAt: null }) };
    },
    {
      body: t.Object({
        payload: t.String(),
        ttl: t.Union([t.Literal("day"), t.Literal("month"), t.Literal("quarter")]),
      }),
    },
  )
  .delete("/you/shares/:shareId", async ({ params, request, set }) => {
    const user = await requireFullUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const row = await db.query.shareSnapshotTable.findFirst({
      where: and(
        eq(shareSnapshotTable.id, params.shareId),
        eq(shareSnapshotTable.userId, user.id),
      ),
    });
    if (!row) {
      set.status = 404;
      return { error: "Share not found." };
    }
    await db
      .update(shareSnapshotTable)
      .set({ revokedAt: new Date(), payload: "{}" })
      .where(eq(shareSnapshotTable.id, row.id));
    return { ok: true };
  })
  .get("/share/:token", async ({ params, set }) => {
    const row = await db.query.shareSnapshotTable.findFirst({
      where: eq(shareSnapshotTable.tokenHash, hashToken(params.token)),
    });
    if (!row || row.revokedAt != null || row.expiresAt.getTime() < Date.now()) {
      // Scrub any expired payload we just refused so it does not linger.
      if (row && row.expiresAt.getTime() < Date.now() && row.revokedAt == null) {
        await db.delete(shareSnapshotTable).where(eq(shareSnapshotTable.id, row.id));
      }
      set.status = 404;
      return { error: "This share link is no longer available." };
    }
    try {
      return {
        payload: JSON.parse(row.payload) as unknown,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      };
    } catch {
      set.status = 404;
      return { error: "This share link is no longer available." };
    }
  });
