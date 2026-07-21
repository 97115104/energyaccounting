import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { sessionTable, userTable } from "../db/schema.ts";

export const SESSION_COOKIE = "eaj_session";
const SESSION_DAYS = 14;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomBytes(16).toString("hex");
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("="));
  }
  return out;
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  return parseCookieHeader(request.headers.get("cookie"))[SESSION_COOKIE];
}

/** YYYY-MM-DD only; rejects path traversal and junk. */
export function assertIsoDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid date");
  }
  const t = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(t)) throw new Error("Invalid date");
  return date;
}

export async function createSession(
  userId: string,
  pendingTotp: boolean,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessionTable).values({
    id: newId(),
    userId,
    tokenHash: hashToken(token),
    expiresAt,
    pendingTotp,
  });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessionTable).where(eq(sessionTable.tokenHash, hashToken(token)));
}

export type AuthUser = typeof userTable.$inferSelect;

export async function sessionFromCookie(
  cookie: string | undefined,
): Promise<{ user: AuthUser; sessionId: string; pendingTotp: boolean } | null> {
  if (!cookie) return null;
  const row = await db.query.sessionTable.findFirst({
    where: eq(sessionTable.tokenHash, hashToken(cookie)),
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessionTable).where(eq(sessionTable.id, row.id));
    return null;
  }
  const user = await db.query.userTable.findFirst({
    where: eq(userTable.id, row.userId),
  });
  if (!user) return null;
  return { user, sessionId: row.id, pendingTotp: row.pendingTotp };
}

export async function requireFullUser(request: Request): Promise<AuthUser | null> {
  const auth = await sessionFromCookie(sessionTokenFromRequest(request));
  if (!auth || auth.pendingTotp) return null;
  return auth.user;
}

export function cookieHeader(token: string, expiresAt: Date): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearCookieHeader(): string {
  const secure = process.env.COOKIE_SECURE === "1" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
