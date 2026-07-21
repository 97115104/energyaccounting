import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/index.ts";
import { sessionTable, userTable } from "../db/schema.ts";
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


export const authRoutes = new Elysia({ prefix: "/api/auth" })
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
      await db.insert(userTable).values({
        id,
        email,
        passwordHash,
        kekSalt: body.kekSalt,
        wrappedDek: body.wrappedDek,
        onboardingCompleted: false,
        locationPrompted: false,
        createdAt: new Date(),
      });
      const { token, expiresAt } = await createSession(id, false);
      set.headers["Set-Cookie"] = cookieHeader(token, expiresAt);
      return {
        user: {
          id,
          email,
          totpEnabled: false,
          timezone: "UTC",
          lat: null,
          lon: null,
          country: "US",
          temperatureUnit: null,
          onboardingCompleted: false,
          locationPrompted: false,
        },
        kekSalt: body.kekSalt,
        wrappedDek: body.wrappedDek,
      };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        kekSalt: t.String(),
        wrappedDek: t.String(),
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
        return { requiresTotp: true };
      }
      return {
        requiresTotp: false,
        user: {
          id: user.id,
          email: user.email,
          totpEnabled: user.totpEnabled,
          timezone: user.timezone,
          lat: user.lat,
          lon: user.lon,
          country: user.country,
          temperatureUnit: user.temperatureUnit,
          onboardingCompleted: user.onboardingCompleted,
          locationPrompted: user.locationPrompted,
        },
        kekSalt: user.kekSalt,
        wrappedDek: user.wrappedDek,
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
        user: {
          id: auth.user.id,
          email: auth.user.email,
          totpEnabled: auth.user.totpEnabled,
          timezone: auth.user.timezone,
          lat: auth.user.lat,
          lon: auth.user.lon,
          country: auth.user.country,
          temperatureUnit: auth.user.temperatureUnit,
          onboardingCompleted: auth.user.onboardingCompleted,
          locationPrompted: auth.user.locationPrompted,
        },
        kekSalt: auth.user.kekSalt,
        wrappedDek: auth.user.wrappedDek,
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
      user: {
        id: auth.user.id,
        email: auth.user.email,
        totpEnabled: auth.user.totpEnabled,
        timezone: auth.user.timezone,
        lat: auth.user.lat,
        lon: auth.user.lon,
        country: auth.user.country,
        temperatureUnit: auth.user.temperatureUnit,
        onboardingCompleted: auth.user.onboardingCompleted,
        locationPrompted: auth.user.locationPrompted,
      },
      kekSalt: auth.user.kekSalt,
      wrappedDek: auth.user.wrappedDek,
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
      await db
        .update(userTable)
        .set({
          timezone: body.timezone ?? auth.user.timezone,
          lat: body.lat !== undefined ? body.lat : auth.user.lat,
          lon: body.lon !== undefined ? body.lon : auth.user.lon,
          country: body.country ?? auth.user.country,
          temperatureUnit:
            body.temperatureUnit === undefined
              ? auth.user.temperatureUnit
              : body.temperatureUnit,
          onboardingCompleted:
            body.onboardingCompleted === undefined
              ? auth.user.onboardingCompleted
              : body.onboardingCompleted,
          locationPrompted:
            body.locationPrompted === undefined
              ? auth.user.locationPrompted
              : body.locationPrompted,
        })
        .where(eq(userTable.id, auth.user.id));
      return { ok: true };
    },
    {
      body: t.Object({
        timezone: t.Optional(t.String()),
        lat: t.Optional(t.Union([t.Number(), t.Null()])),
        lon: t.Optional(t.Union([t.Number(), t.Null()])),
        country: t.Optional(t.String()),
        temperatureUnit: t.Optional(t.Union([t.Literal("C"), t.Literal("F"), t.Null()])),
        onboardingCompleted: t.Optional(t.Boolean()),
        locationPrompted: t.Optional(t.Boolean()),
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
  );
