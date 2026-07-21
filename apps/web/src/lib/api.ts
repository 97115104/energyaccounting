/** Fired after any successful day mutation so live listeners (the butterfly) refresh. */
export const DAY_CHANGED_EVENT = "eaj-day-changed";

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && path.startsWith("/api/days")) {
    window.dispatchEvent(new Event(DAY_CHANGED_EVENT));
  }
  return data;
}
