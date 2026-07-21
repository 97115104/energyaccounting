/** US federal-style fixed-date holidays plus observed weekends (simple, offline). */

const FIXED: { m: number; d: number; name: string }[] = [
  { m: 1, d: 1, name: "New Year's Day" },
  { m: 6, d: 19, name: "Juneteenth" },
  { m: 7, d: 4, name: "Independence Day" },
  { m: 11, d: 11, name: "Veterans Day" },
  { m: 12, d: 25, name: "Christmas Day" },
];

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const d = new Date(Date.UTC(year, month - 1, 1));
  let count = 0;
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  throw new Error("nth weekday not found");
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month, 0));
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function holidayForDate(dateIso: string, country = "US"): { isHoliday: boolean; name: string | null } {
  if (country !== "US") {
    // Minimal: still flag fixed New Year / Christmas globally.
    const [, mm, dd] = dateIso.split("-").map(Number);
    if (mm === 1 && dd === 1) return { isHoliday: true, name: "New Year's Day" };
    if (mm === 12 && dd === 25) return { isHoliday: true, name: "Christmas Day" };
    return { isHoliday: false, name: null };
  }

  const [y, m, d] = dateIso.split("-").map(Number);
  for (const f of FIXED) {
    if (f.m === m && f.d === d) return { isHoliday: true, name: f.name };
  }

  const floating: { iso: string; name: string }[] = [
    { iso: iso(nthWeekday(y, 1, 1, 3)), name: "Martin Luther King Jr. Day" },
    { iso: iso(nthWeekday(y, 2, 1, 3)), name: "Presidents' Day" },
    { iso: iso(lastWeekday(y, 5, 1)), name: "Memorial Day" },
    { iso: iso(nthWeekday(y, 9, 1, 1)), name: "Labor Day" },
    { iso: iso(nthWeekday(y, 10, 1, 2)), name: "Columbus Day" },
    { iso: iso(nthWeekday(y, 11, 4, 4)), name: "Thanksgiving" },
  ];
  for (const h of floating) {
    if (h.iso === dateIso) return { isHoliday: true, name: h.name };
  }
  return { isHoliday: false, name: null };
}
