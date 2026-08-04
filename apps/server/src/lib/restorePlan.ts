export type RestorePlanLine = Readonly<{ sourceId: string }>;
export type RestorePlanDay = Readonly<{
  sourceId: string;
  phase: string;
  lines: readonly RestorePlanLine[];
}>;

export type RestorePlanIndexes = Readonly<{
  /** Includes source IDs and the legacy local IDs used before restore support. */
  dayIdBySource: ReadonlyMap<string, string>;
  lineSourcesByDay: ReadonlyMap<string, ReadonlySet<string>>;
  activeDayId: string | null;
  activeDaySourceId: string | null;
}>;

export type RestoreDayAction = Readonly<{
  sourceId: string;
  targetDayId: string | null;
  action: "insert" | "merge" | "skip-active-conflict";
  lineSourceIdsToInsert: readonly string[];
  lineSourceIdsExisting: readonly string[];
}>;

export type RestorePlan = Readonly<{
  days: readonly RestoreDayAction[];
  daysToAdd: number;
  daysExisting: number;
  daysSkippedForActiveConflict: number;
  linesToAdd: number;
  linesExisting: number;
  activeDayConflict: boolean;
  currentActiveSourceId: string | null;
  importedActiveSourceId: string | null;
}>;

/** Pure, deterministic restore diff. Database rows never leave the adapter. */
export function buildRestorePlan(
  days: readonly RestorePlanDay[],
  indexes: RestorePlanIndexes,
  activeDayResolution?: "keep-current" | "replace-current",
): RestorePlan {
  let daysToAdd = 0;
  let daysExisting = 0;
  let daysSkippedForActiveConflict = 0;
  let linesToAdd = 0;
  let linesExisting = 0;
  let importedActiveSourceId: string | null = null;
  let activeDayConflict = false;
  const actions: RestoreDayAction[] = [];

  for (const sourceDay of days) {
    const targetDayId = indexes.dayIdBySource.get(sourceDay.sourceId) ?? null;
    const isNewActive = sourceDay.phase !== "closed" && !targetDayId;
    if (sourceDay.phase !== "closed") importedActiveSourceId = sourceDay.sourceId;
    const conflict = isNewActive && indexes.activeDayId !== null;
    activeDayConflict ||= conflict;
    if (conflict && activeDayResolution === "keep-current") {
      daysSkippedForActiveConflict += 1;
      actions.push({
        sourceId: sourceDay.sourceId,
        targetDayId: null,
        action: "skip-active-conflict",
        lineSourceIdsToInsert: [],
        lineSourceIdsExisting: [],
      });
      continue;
    }
    if (!targetDayId) {
      daysToAdd += 1;
      linesToAdd += sourceDay.lines.length;
      actions.push({
        sourceId: sourceDay.sourceId,
        targetDayId: null,
        action: "insert",
        lineSourceIdsToInsert: sourceDay.lines.map((line) => line.sourceId),
        lineSourceIdsExisting: [],
      });
      continue;
    }
    daysExisting += 1;
    const existingSources = indexes.lineSourcesByDay.get(targetDayId) ?? new Set<string>();
    const lineSourceIdsToInsert = sourceDay.lines
      .map((line) => line.sourceId)
      .filter((sourceId) => !existingSources.has(sourceId));
    const lineSourceIdsExisting = sourceDay.lines
      .map((line) => line.sourceId)
      .filter((sourceId) => existingSources.has(sourceId));
    linesToAdd += lineSourceIdsToInsert.length;
    linesExisting += lineSourceIdsExisting.length;
    actions.push({
      sourceId: sourceDay.sourceId,
      targetDayId,
      action: "merge",
      lineSourceIdsToInsert,
      lineSourceIdsExisting,
    });
  }

  return {
    days: actions,
    daysToAdd,
    daysExisting,
    daysSkippedForActiveConflict,
    linesToAdd,
    linesExisting,
    activeDayConflict,
    currentActiveSourceId: indexes.activeDaySourceId,
    importedActiveSourceId,
  };
}
