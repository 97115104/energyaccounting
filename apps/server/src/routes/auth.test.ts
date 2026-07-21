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
