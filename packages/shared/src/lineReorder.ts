import type { TaskSide } from "./balance";

export type ReorderableLine = Readonly<{ id: string; side: TaskSide; sort: number }>;
export type LinePosition = Readonly<{ id: string; side: TaskSide; sort: number }>;

const byPosition = (left: ReorderableLine, right: ReorderableLine) =>
  left.sort - right.sort || left.id.localeCompare(right.id);

/**
 * Purely derive the smallest complete set of side/sort changes for a drag.
 * The output is deterministic and can therefore be optimistically applied and
 * committed atomically by the server.
 */
export function deriveLineReorder(
  lines: readonly ReorderableLine[],
  lineId: string,
  targetSide: TaskSide,
  targetIndex: number,
): LinePosition[] {
  const moving = lines.find((line) => line.id === lineId);
  if (!moving) return [];
  const ordered = (side: TaskSide) => lines.filter((line) => line.side === side).sort(byPosition);
  const desired = new Map<string, Omit<LinePosition, "id">>();
  const source = ordered(moving.side);
  const target = ordered(targetSide);

  if (moving.side !== targetSide) {
    source
      .filter((line) => line.id !== lineId)
      .forEach((line, sort) => desired.set(line.id, { side: moving.side, sort }));
  }

  const sourceIndex = moving.side === targetSide ? target.findIndex((line) => line.id === lineId) : -1;
  const adjusted = sourceIndex >= 0 && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
  const nextTarget = target.filter((line) => line.id !== lineId);
  nextTarget.splice(Math.max(0, Math.min(adjusted, nextTarget.length)), 0, { ...moving, side: targetSide });
  nextTarget.forEach((line, sort) => desired.set(line.id, { side: targetSide, sort }));

  return lines.flatMap((line) => {
    const next = desired.get(line.id);
    return next && (next.side !== line.side || next.sort !== line.sort)
      ? [{ id: line.id, ...next }]
      : [];
  });
}

export function applyLinePositions<T extends ReorderableLine>(
  lines: readonly T[],
  positions: readonly LinePosition[],
): T[] {
  const updates = new Map(positions.map((position) => [position.id, position]));
  return lines.map((line) => {
    const next = updates.get(line.id);
    return next ? { ...line, side: next.side, sort: next.sort } : line;
  });
}
