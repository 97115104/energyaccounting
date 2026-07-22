import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

// The db module resolves DATA_DIR at import time, so point it at a throwaway
// directory before anything pulls it in (dynamic imports keep the ordering).
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "eaj-auth-test-"));

const { db } = await import("../db/index.ts");
const { inviteCodeTable, userTable } = await import("../db/schema.ts");
const { authRoutes } = await import("./auth.ts");
const { generateInviteCode, hashInviteCode } = await import("../lib/inviteCodes.ts");

async function mintInvite(): Promise<string> {
  const code = generateInviteCode();
  await db.insert(inviteCodeTable).values({
    id: randomBytes(16).toString("hex"),
    codeHash: hashInviteCode(code),
    createdAt: new Date(),
  });
  return code;
}

function post(path: string, body: unknown): Promise<Response> {
  return authRoutes.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function registerBody(email: string, inviteCode: string) {
  return {
    email,
    password: "correct horse battery",
    kekSalt: "test-salt",
    wrappedDek: "test-wrapped-dek",
    inviteCode,
  };
}

describe("POST /api/auth/invite/check", () => {
  test("accepts an unused code regardless of case and separators", async () => {
    const code = await mintInvite();
    const res = await post("/invite/check", { code: code.toUpperCase().replace(/-/g, " ") });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
  });

  test("rejects malformed and unknown codes with one generic message", async () => {
    const malformed = await post("/invite/check", { code: "nope" });
    const unknown = await post("/invite/check", { code: generateInviteCode() });
    expect(malformed.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await malformed.json()).toEqual(await unknown.json());
  });

  test("does not consume the code", async () => {
    const code = await mintInvite();
    await post("/invite/check", { code });
    const row = await db.query.inviteCodeTable.findFirst({
      where: eq(inviteCodeTable.codeHash, hashInviteCode(code)),
    });
    expect(row?.usedAt).toBeNull();
  });
});

describe("POST /api/auth/register invite gate", () => {
  test("rejects registration without a valid code and creates no user", async () => {
    const res = await post("/register", registerBody("no-invite@example.com", "bogus"));
    expect(res.status).toBe(403);
    const user = await db.query.userTable.findFirst({
      where: eq(userTable.email, "no-invite@example.com"),
    });
    expect(user).toBeUndefined();
  });

  test("consumes a valid code exactly once and records the user", async () => {
    const code = await mintInvite();
    const first = await post("/register", registerBody("winner@example.com", code));
    expect(first.status).toBe(200);
    const user = await db.query.userTable.findFirst({
      where: eq(userTable.email, "winner@example.com"),
    });
    expect(user).toBeDefined();
    const invite = await db.query.inviteCodeTable.findFirst({
      where: eq(inviteCodeTable.codeHash, hashInviteCode(code)),
    });
    expect(invite?.usedAt).not.toBeNull();
    expect(invite?.usedByUserId).toBe(user!.id);

    const second = await post("/register", registerBody("loser@example.com", code));
    expect(second.status).toBe(403);
    const loser = await db.query.userTable.findFirst({
      where: eq(userTable.email, "loser@example.com"),
    });
    expect(loser).toBeUndefined();
  });

  test("duplicate email returns 409 and does not burn the invite", async () => {
    const code = await mintInvite();
    const dup = await post("/register", registerBody("winner@example.com", code));
    expect(dup.status).toBe(409);
    const invite = await db.query.inviteCodeTable.findFirst({
      where: eq(inviteCodeTable.codeHash, hashInviteCode(code)),
    });
    expect(invite?.usedAt).toBeNull();
    expect(invite?.usedByUserId).toBeNull();
  });

  test("concurrent registers with one code admit exactly one account", async () => {
    const code = await mintInvite();
    const results = await Promise.all([
      post("/register", registerBody("race-a@example.com", code)),
      post("/register", registerBody("race-b@example.com", code)),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 403]);
    const users = await db.select().from(userTable);
    const raceUsers = users.filter((u) => u.email.startsWith("race-"));
    expect(raceUsers.length).toBe(1);
  });
});

describe("POST /api/auth/email", () => {
  const PASSWORD = "correct horse battery";

  async function makeSession(prefix: string): Promise<{ userId: string; email: string; cookie: string }> {
    const { SESSION_COOKIE, hashToken, newId } = await import("../lib/session.ts");
    const { sessionTable } = await import("../db/schema.ts");
    const userId = newId();
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
    return { userId, email, cookie: `${SESSION_COOKIE}=${token}` };
  }

  function emailReq(cookie: string, body: unknown): Request {
    return new Request("http://localhost/api/auth/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
      },
      body: JSON.stringify(body),
    });
  }

  test("changes email when password is correct", async () => {
    const { email, cookie } = await makeSession("email-ok");
    const next = `renamed-${email}`;
    const res = await authRoutes.handle(
      emailReq(cookie, { email: next, password: PASSWORD }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { email: string } };
    expect(json.user.email).toBe(next.toLowerCase());
    const row = await db.query.userTable.findFirst({
      where: eq(userTable.email, next.toLowerCase()),
    });
    expect(row).toBeDefined();
  });

  test("rejects wrong password", async () => {
    const { email, cookie } = await makeSession("email-bad-pw");
    const res = await authRoutes.handle(
      emailReq(cookie, { email: `new-${email}`, password: "nope" }),
    );
    expect(res.status).toBe(401);
  });

  test("rejects duplicate email", async () => {
    const a = await makeSession("email-dup-a");
    const b = await makeSession("email-dup-b");
    const res = await authRoutes.handle(
      emailReq(a.cookie, { email: b.email, password: PASSWORD }),
    );
    expect(res.status).toBe(409);
  });

  test("with TOTP enabled requires a code", async () => {
    const { createHash } = await import("node:crypto");
    const { generateTotpSecret } = await import("../lib/totp.ts");
    const { userId, email, cookie } = await makeSession("email-totp-req");
    const secret = generateTotpSecret();
    await db
      .update(userTable)
      .set({
        totpEnabled: true,
        totpSecret: secret,
        recoveryCodesHash: JSON.stringify([
          createHash("sha256").update("recovery-unused".toLowerCase()).digest("hex"),
        ]),
      })
      .where(eq(userTable.id, userId));
    const res = await authRoutes.handle(
      emailReq(cookie, { email: `new-${email}`, password: PASSWORD }),
    );
    expect(res.status).toBe(400);
  });

  test("with TOTP enabled accepts a recovery code", async () => {
    const { createHash } = await import("node:crypto");
    const { generateTotpSecret } = await import("../lib/totp.ts");
    const { userId, email, cookie } = await makeSession("email-totp-rec");
    const secret = generateTotpSecret();
    const recovery = "abcd-efgh-ijkl";
    await db
      .update(userTable)
      .set({
        totpEnabled: true,
        totpSecret: secret,
        recoveryCodesHash: JSON.stringify([
          createHash("sha256").update(recovery.toLowerCase()).digest("hex"),
        ]),
      })
      .where(eq(userTable.id, userId));
    const next = `recovered-${email}`;
    const res = await authRoutes.handle(
      emailReq(cookie, { email: next, password: PASSWORD, code: recovery }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { user: { email: string } };
    expect(json.user.email).toBe(next.toLowerCase());
    const row = await db.query.userTable.findFirst({
      where: eq(userTable.id, userId),
    });
    expect(JSON.parse(row!.recoveryCodesHash!)).toEqual([]);
  });
});
