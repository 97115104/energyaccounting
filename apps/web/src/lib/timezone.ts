// Single home for "what time is it for the user" decisions. Profile timezones
// default to UTC on the server, so any live surface (sky theme, greeting) that
// trusted them verbatim would flip a local afternoon into evening/night. These
// helpers encode the device-first rule once so call sites can't drift apart.

/** The browser's IANA timezone, or undefined when the runtime can't say. */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Timezone for live, "right now" surfaces: device first, then the stored
 * profile zone, then UTC. Device deliberately wins even over an explicit
 * profile zone: live surfaces describe what this screen's clock says, while
 * the profile zone remains the stored account setting (Settings, exports).
 */
export function liveTimezone(profileTimezone?: string | null): string {
  return deviceTimezone() || profileTimezone || "UTC";
}

/**
 * Hour of day (0-23) in an IANA timezone. A missing or invalid zone falls
 * back to the device's local clock rather than throwing.
 */
export function hourInTimezone(now: Date, timeZone?: string | null): number {
  if (!timeZone) return now.getHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "hour")?.value;
    if (raw == null) return now.getHours();
    // Some engines emit "24" for midnight, so normalize into 0-23.
    return Number(raw) % 24;
  } catch {
    return now.getHours();
  }
}

/** Night is local hour < 6 or >= 20 (shared by sky theme and weather UI). */
export function isNightInTimezone(timezone: string, now = new Date()): boolean {
  const hour = hourInTimezone(now, timezone || "UTC");
  return hour < 6 || hour >= 20;
}
