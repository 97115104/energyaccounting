/** Daily energy math uses a fresh finite supply; Attwood column totals sit alongside it. */

export const DAILY_ENERGY = 100;

export type TaskSide = "deposit" | "withdrawal";

export type DayPhase = "plan" | "audit" | "closed";

export interface TaskCosts {
  side: TaskSide;
  /** Prefer actual when set; else planned. */
  planned: number;
  actual: number | null;
}

/** Task row that can reserve capacity until completed (energy GC). */
export interface AllocatableTask extends TaskCosts {
  completed?: boolean;
}

export function clampCost(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Optional personal reflection score; null means the task was not rated. */
export function clampDifficulty(n: number | null | undefined): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.max(1, Math.min(10, Math.round(n)));
}

export function effectiveCost(t: TaskCosts): number {
  return clampCost(t.actual ?? t.planned);
}

/** Attwood: sum of deposit column vs withdrawal column (0–100 each). */
export function attwoodTotals(tasks: TaskCosts[]): {
  depositTotal: number;
  withdrawalTotal: number;
  attwoodNet: number;
} {
  let depositTotal = 0;
  let withdrawalTotal = 0;
  for (const t of tasks) {
    const c = effectiveCost(t);
    if (t.side === "deposit") depositTotal += c;
    else withdrawalTotal += c;
  }
  return {
    depositTotal,
    withdrawalTotal,
    attwoodNet: depositTotal - withdrawalTotal,
  };
}

/** Every started day receives the same supply; prior results remain historical context only. */
export function openingBalance(_previousClosing: number | null = null): number {
  return DAILY_ENERGY;
}

export function closingBalance(
  opening: number,
  tasks: TaskCosts[],
): number {
  const { depositTotal, withdrawalTotal } = attwoodTotals(tasks);
  return opening + depositTotal - withdrawalTotal;
}

/** Planned cost still locked in incomplete lines (finite daily supply). */
export function reservedCapacity(tasks: AllocatableTask[]): number {
  let sum = 0;
  for (const t of tasks) {
    if (t.completed) continue;
    sum += clampCost(t.planned);
  }
  return sum;
}

/** Planned points released by completed work, tracked separately from balance. */
export function completedFreedEnergy(tasks: AllocatableTask[]): number {
  return tasks.reduce((sum, task) => sum + (task.completed ? clampCost(task.planned) : 0), 0);
}

/** Points free to allocate to new tasks after incomplete reservations. */
export function availableCapacity(opening: number, tasks: AllocatableTask[]): number {
  return Math.max(0, opening - reservedCapacity(tasks));
}

/** True when withdrawals dominate deposits enough to warrant play deposits. */
export function isWithdrawalHeavy(
  attwood: { depositTotal: number; withdrawalTotal: number },
  margin = 0,
): boolean {
  return attwood.withdrawalTotal > attwood.depositTotal + margin;
}

export function isoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
