/**
 * Completed-task footer praise: sentence-case encouragement with a variable
 * pool so the line stays fresh without churning every render (visit-seeded).
 */

const visitSeed = Math.random();

const ONE = [
  "1 done already. Nice!",
  "1 done. That counts!",
  "1 checked off. Good start!",
];

const TWO = [
  "2 done already. Well done!",
  "2 completed. Keep going!",
  "2 done. You're on a roll!",
];

const THREE = [
  "3 done. You're awesome!",
  "3 completed. Well done you!",
  "3 done already. Looking good!",
];

const MANY = [
  "{n} done already. Incredible!",
  "{n} completed. You're on fire!",
  "{n} done. Keep that momentum!",
  "{n} done already. Well done you!",
];

function poolFor(count: number): string[] {
  if (count <= 1) return ONE;
  if (count === 2) return TWO;
  if (count === 3) return THREE;
  return MANY;
}

/** Stable praise for a completion count within this visit. */
export function completedFooterPraise(count: number): string {
  const n = Math.floor(count);
  if (n < 1) return "";
  const pool = poolFor(n);
  const idx = Math.floor((visitSeed * 997 + n * 31) % pool.length);
  return pool[idx]!.replaceAll("{n}", String(n));
}
