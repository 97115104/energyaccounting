// Device-local "has signed in here before" hint. Purely cosmetic (header copy
// and default auth mode); the real session lives in an httpOnly cookie.

const KEY = "eaj-returning";

export function hasReturningFlag(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function markReturning(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* private mode; the pitch shows again, which is harmless */
  }
}
