// Tiny shared helpers for ISO-date stats, previously copy-pasted across the
// insight/guide/trait/draft libs.

/**
 * English weekday name for a YYYY-MM-DD string. Noon UTC keeps the calendar
 * date stable regardless of the device timezone.
 */
export function weekdayName(dateIso: string): string {
  return new Date(dateIso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/** Arithmetic mean; empty input yields 0 so callers can compare freely. */
export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
