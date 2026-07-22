import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/index.ts";
import { inviteCodeTable, sessionTable, userTable } from "../db/schema.ts";
import { hashInviteCode, isWellFormedInviteCode } from "../lib/inviteCodes.ts";
import { sanitizeIdentity } from "../lib/identity.ts";
import {
  SESSION_COOKIE,
  clearCookieHeader,
  cookieHeader,
  createSession,
  destroySession,
  newId,
  sessionFromCookie,
} from "../lib/session.ts";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  totpQrDataUrl,
  totpUri,
  verifyTotp,
} from "../lib/totp.ts";

function hashCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase()).digest("hex");
}

/** One shape for every login/me/register response so fields never drift. */
function publicUser(user: typeof userTable.$inferSelect) {
  return {
    id: user.id,
    email: user.email,
    totpEnabled: user.totpEnabled,
    displayName: user.displayName,
    timezone: user.timezone,
    lat: user.lat,
    lon: user.lon,
    country: user.country,
    temperatureUnit: user.temperatureUnit,
    greetingStyle: user.greetingStyle,
    includePhysicalActivities: user.includePhysicalActivities,
    onboardingCompleted: user.onboardingCompleted,
    locationPrompted: user.locationPrompted,
    identity: parseIdentityJson(user.identityJson),
  };
}

function parseIdentityJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const MAX_IDENTITY_BYTES = 4 * 1024;
function parseCookie(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function tokenFromRequest(request: Request): string | undefined {
  return parseCookie(request.headers.get("cookie"))[SESSION_COOKIE];
}


// One generic message for malformed, unknown, and spent codes — no oracle for
// guessing which codes exist.
const INVITE_ERROR = "Invite code is invalid or already used.";

async function findUnusedInvite(codeHash: string) {
  return db.query.inviteCodeTable.findFirst({
    where: and(eq(inviteCodeTable.codeHash, codeHash), isNull(inviteCodeTable.usedAt)),
  });
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    // Preflight so the UI can gate the signup form; register re-checks and is
    // the only place a code is actually consumed.
    "/invite/check",
    async ({ body, set }) => {
      if (isWellFormedInviteCode(body.code)) {
        const invite = await findUnusedInvite(hashInviteCode(body.code));
        if (invite) return { valid: true };
      }
      set.status = 403;
      return { valid: false, error: INVITE_ERROR };
    },
    { body: t.Object({ code: t.String() }) },
  )
  .post(
    "/register",
    async ({ body, set }) => {
      const email = body.email.trim().toLowerCase();
      if (!email || body.password.length < 8) {
        set.status = 400;
        return { error: "Email and password (8+ characters) are required." };
      }
      if (!body.wrappedDek || !body.kekSalt) {
        set.status = 400;
        return { error: "Client must supply wrappedDek and kekSalt." };
      }
      if (!isWellFormedInviteCode(body.inviteCode)) {
        set.status = 403;
        return { error: INVITE_ERROR };
      }
      const inviteHash = hashInviteCode(body.inviteCode);
      const existing = await db.query.userTable.findFirst({
        where: eq(userTable.email, email),
      });
      if (existing) {
        set.status = 409;
        return { error: "An account with that email already exists." };
      }
      const passwordHash = await Bun.password.hash(body.password, {
        algorithm: "argon2id",
        memoryCost: 19456,
        timeCost: 2,
      });
      const id = newId();
      const timezone =
        typeof body.timezone === "string" && body.timezone.trim()
          ? body.timezone.trim()
          : "UTC";
      // One transaction so an invite can never be burned without its account
      // existing: the `used_at IS NULL` guard lets exactly one concurrent
      // register flip the row, the re-read confirms we were that winner, and
      // any failure (loser, email unique race, crash) rolls the claim back.
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(inviteCodeTable)
            .set({ usedAt: new Date(), usedByUserId: id })
            .where(and(eq(inviteCodeTable.codeHash, inviteHash), isNull(inviteCodeTable.usedAt)));
          const [claimed] = await tx
            .select()
            .from(inviteCodeTable)
            .where(eq(inviteCodeTable.codeHash, inviteHash));
          if (!claimed || claimed.usedByUserId !== id) {
            throw new Error("invite-not-claimed");
          }
          await tx.insert(userTable).values({
            id,
            email,
            passwordHash,
            kekSalt: body.kekSalt,
            wrappedDek: body.wrappedDek,
            timezone,
            onboardingCompleted: false,
            locationPrompted: false,
            createdAt: new Date(),
          });
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "invite-not-claimed") {
          set.status = 403;
          return { error: INVITE_ERROR };
        }
        if (msg.includes("UNIQUE")) {
          // Email race past the earlier existence check; rollback kept the invite.
          set.status = 409;
          return { error: "An account with that email already exists." };
        }
        throw e;
      }
      const { token, expiresAt } = await createSession(id, false);
      set.headers["Set-Cookie"] = cookieHeader(token, expiresAt);
      const created = await db.query.userTable.findFirst({ where: eq(userTable.id, id) });
      return {
        user: publicUser(created!),
        kekSalt: body.kekSalt,
        wrappedDek: body.wrappedDek,
        sessionExpiresAt: expiresAt.toISOString(),
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        kekSalt: t.String(),
        wrappedDek: t.String(),
        inviteCode: t.String(),
        timezone: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/login",
    async ({ body, set }) => {
      const email = body.email.trim().toLowerCase();
      const user = await db.query.userTable.findFirst({
        where: eq(userTable.email, email),
      });
      if (!user) {
        set.status = 401;
        return { error: "Invalid email or password." };
      }
      const ok = await Bun.password.verify(body.password, user.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: "Invalid email or password." };
      }
      const needsTotp = user.totpEnabled;
      const { token, expiresAt } = await createSession(user.id, needsTotp);
      set.headers["Set-Cookie"] = cookieHeader(token, expiresAt);
      if (needsTotp) {
        return { requiresTotp: true, sessionExpiresAt: expiresAt.toISOString() };
      }
      return {
        requiresTotp: false,
        user: publicUser(user),
        kekSalt: user.kekSalt,
        wrappedDek: user.wrappedDek,
        sessionExpiresAt: expiresAt.toISOString(),
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  )
  .post(
    "/totp/verify-login",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || !auth.pendingTotp) {
        set.status = 401;
        return { error: "No pending TOTP challenge." };
      }
      const secret = auth.user.totpSecret;
      if (!secret || !verifyTotp(secret, body.code)) {
        // recovery code path
        let usedRecovery = false;
        if (auth.user.recoveryCodesHash) {
          try {
            const hashes = JSON.parse(auth.user.recoveryCodesHash) as string[];
            const h = hashCode(body.code);
            const idx = hashes.indexOf(h);
            if (idx >= 0) {
              hashes.splice(idx, 1);
              await db
                .update(userTable)
                .set({ recoveryCodesHash: JSON.stringify(hashes) })
                .where(eq(userTable.id, auth.user.id));
              usedRecovery = true;
            }
          } catch {
            /* ignore */
          }
        }
        if (!usedRecovery) {
          set.status = 401;
          return { error: "Invalid authenticator code." };
        }
      }
      await db
        .update(sessionTable)
        .set({ pendingTotp: false })
        .where(eq(sessionTable.id, auth.sessionId));
      return {
        user: publicUser(auth.user),
        kekSalt: auth.user.kekSalt,
        wrappedDek: auth.user.wrappedDek,
        sessionExpiresAt: auth.expiresAt.toISOString(),
      };
    },
    { body: t.Object({ code: t.String() }) },
  )
  .post("/logout", async ({ request, set }) => {
    const token = tokenFromRequest(request);
    if (token) await destroySession(token);
    set.headers["Set-Cookie"] = clearCookieHeader();
    return { ok: true };
  })
  .get("/me", async ({ request, set }) => {
    const auth = await sessionFromCookie(tokenFromRequest(request));
    if (!auth) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    if (auth.pendingTotp) {
      return { requiresTotp: true };
    }
    return {
      user: publicUser(auth.user),
      kekSalt: auth.user.kekSalt,
      wrappedDek: auth.user.wrappedDek,
      sessionExpiresAt: auth.expiresAt.toISOString(),
    };
  })
  .post(
    "/totp/setup",
    async ({ request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (auth.user.totpEnabled) {
        set.status = 400;
        return { error: "TOTP is already enabled. Disable it before setting up again." };
      }
      const secret = generateTotpSecret();
      await db
        .update(userTable)
        .set({ totpSecret: secret, totpEnabled: false })
        .where(eq(userTable.id, auth.user.id));
      const uri = totpUri(auth.user.email, secret);
      const qr = await totpQrDataUrl(uri);
      return { secret, uri, qr };
    },
  )
  .post(
    "/totp/enable",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const secret = auth.user.totpSecret;
      if (!secret || !verifyTotp(secret, body.code)) {
        set.status = 400;
        return { error: "Invalid code. Scan the QR again and retry." };
      }
      const codes = generateRecoveryCodes();
      await db
        .update(userTable)
        .set({
          totpEnabled: true,
          recoveryCodesHash: JSON.stringify(codes.map(hashCode)),
        })
        .where(eq(userTable.id, auth.user.id));
      return { enabled: true, recoveryCodes: codes };
    },
    { body: t.Object({ code: t.String() }) },
  )
  .post(
    "/totp/disable",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const pwOk = await Bun.password.verify(body.password, auth.user.passwordHash);
      if (!pwOk) {
        set.status = 401;
        return { error: "Password incorrect." };
      }
      if (!auth.user.totpSecret || !verifyTotp(auth.user.totpSecret, body.code)) {
        set.status = 400;
        return { error: "Authenticator code invalid." };
      }
      await db
        .update(userTable)
        .set({ totpEnabled: false, totpSecret: null, recoveryCodesHash: null })
        .where(eq(userTable.id, auth.user.id));
      return { enabled: false };
    },
    { body: t.Object({ password: t.String(), code: t.String() }) },
  )
  .patch(
    "/profile",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const patch = {
        // Only write fields the client sent because rewriting omitted columns from a
        // stale session snapshot races with concurrent profile PATCHes (geo vs
        // onboarding) and can clobber a just-saved displayName / coords.
        ...(body.displayName !== undefined
          ? { displayName: body.displayName?.trim() || null }
          : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.lat !== undefined ? { lat: body.lat } : {}),
        ...(body.lon !== undefined ? { lon: body.lon } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.temperatureUnit !== undefined
          ? { temperatureUnit: body.temperatureUnit }
          : {}),
        ...(body.greetingStyle !== undefined ? { greetingStyle: body.greetingStyle } : {}),
        ...(body.includePhysicalActivities !== undefined
          ? { includePhysicalActivities: body.includePhysicalActivities }
          : {}),
        ...(body.onboardingCompleted !== undefined
          ? { onboardingCompleted: body.onboardingCompleted }
          : {}),
        ...(body.locationPrompted !== undefined
          ? { locationPrompted: body.locationPrompted }
          : {}),
      };
      if (body.identity !== undefined) {
        if (body.identity === null) {
          Object.assign(patch, { identityJson: null });
        } else {
          const cleaned = sanitizeIdentity(body.identity, auth.user.id);
          if (!cleaned) {
            set.status = 400;
            return { error: "Identity config is invalid." };
          }
          const serialized = JSON.stringify(cleaned);
          if (serialized.length > MAX_IDENTITY_BYTES) {
            set.status = 400;
            return { error: "Identity config is too large." };
          }
          Object.assign(patch, { identityJson: serialized });
        }
      }
      if (Object.keys(patch).length > 0) {
        await db.update(userTable).set(patch).where(eq(userTable.id, auth.user.id));
      }
      return { ok: true };
    },
    {
      body: t.Object({
        displayName: t.Optional(t.Union([t.String({ maxLength: 80 }), t.Null()])),
        timezone: t.Optional(t.String()),
        lat: t.Optional(t.Union([t.Number(), t.Null()])),
        lon: t.Optional(t.Union([t.Number(), t.Null()])),
        country: t.Optional(t.String()),
        temperatureUnit: t.Optional(t.Union([t.Literal("C"), t.Literal("F"), t.Null()])),
        greetingStyle: t.Optional(
          t.Union([
            t.Literal("classic"),
            t.Literal("humor"),
            t.Literal("facts"),
            t.Literal("mix"),
            t.Null(),
          ]),
        ),
        includePhysicalActivities: t.Optional(t.Boolean()),
        onboardingCompleted: t.Optional(t.Boolean()),
        locationPrompted: t.Optional(t.Boolean()),
        // Render-only NeuroMe config; stored as JSON, validated for size here
        // and normalized field by field on the client.
        identity: t.Optional(t.Union([t.Record(t.String(), t.Unknown()), t.Null()])),
      }),
    },
  )
  .post(
    "/password",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const ok = await Bun.password.verify(body.currentPassword, auth.user.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: "Current password incorrect." };
      }
      if (!body.wrappedDek || !body.kekSalt) {
        set.status = 400;
        return { error: "Re-wrapped DEK required." };
      }
      const passwordHash = await Bun.password.hash(body.newPassword, {
        algorithm: "argon2id",
        memoryCost: 19456,
        timeCost: 2,
      });
      await db
        .update(userTable)
        .set({
          passwordHash,
          kekSalt: body.kekSalt,
          wrappedDek: body.wrappedDek,
        })
        .where(eq(userTable.id, auth.user.id));
      return { ok: true };
    },
    {
      body: t.Object({
        currentPassword: t.String(),
        newPassword: t.String(),
        kekSalt: t.String(),
        wrappedDek: t.String(),
      }),
    },
  )
  .post(
    "/email",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const email = body.email.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        set.status = 400;
        return { error: "Enter a valid email address." };
      }
      const ok = await Bun.password.verify(body.password, auth.user.passwordHash);
      if (!ok) {
        set.status = 401;
        return { error: "Password incorrect." };
      }
      if (auth.user.totpEnabled) {
        if (!auth.user.totpSecret || !body.code || !verifyTotp(auth.user.totpSecret, body.code)) {
          set.status = 400;
          return { error: "Authenticator code invalid." };
        }
      }
      if (email === auth.user.email) {
        return { user: publicUser(auth.user) };
      }
      const taken = await db.query.userTable.findFirst({
        where: eq(userTable.email, email),
      });
      if (taken) {
        set.status = 409;
        return { error: "An account with that email already exists." };
      }
      try {
        await db.update(userTable).set({ email }).where(eq(userTable.id, auth.user.id));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("UNIQUE")) {
          set.status = 409;
          return { error: "An account with that email already exists." };
        }
        throw e;
      }
      const updated = await db.query.userTable.findFirst({
        where: eq(userTable.id, auth.user.id),
      });
      if (!updated) {
        set.status = 500;
        return { error: "Email update failed." };
      }
      return { user: publicUser(updated) };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        code: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/delete-account",
    async ({ body, request, set }) => {
      const auth = await sessionFromCookie(tokenFromRequest(request));
      if (!auth || auth.pendingTotp) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      const pwOk = await Bun.password.verify(body.password, auth.user.passwordHash);
      if (!pwOk) {
        set.status = 401;
        return { error: "Password incorrect." };
      }
      // The typed confirmation is checked client-side for UX and re-checked
      // here so a bare API call cannot skip the deliberate step.
      if (body.confirm !== "DELETE") {
        set.status = 400;
        return { error: "Type DELETE to confirm." };
      }
      if (auth.user.totpEnabled) {
        if (!auth.user.totpSecret || !body.code || !verifyTotp(auth.user.totpSecret, body.code)) {
          set.status = 400;
          return { error: "Authenticator code invalid." };
        }
      }
      // One row delete removes everything: sessions, days, task lines,
      // catalog, You profile, and share snapshots all cascade from user_table.
      // The invite audit column has no FK by design, so scrub it explicitly:
      // after deletion nothing may point back at the account.
      await db.transaction(async (tx) => {
        await tx
          .update(inviteCodeTable)
          .set({ usedByUserId: null })
          .where(eq(inviteCodeTable.usedByUserId, auth.user.id));
        await tx.delete(userTable).where(eq(userTable.id, auth.user.id));
      });
      set.headers["Set-Cookie"] = clearCookieHeader();
      return { ok: true };
    },
    {
      body: t.Object({
        password: t.String(),
        confirm: t.String(),
        code: t.Optional(t.String()),
      }),
    },
  );
