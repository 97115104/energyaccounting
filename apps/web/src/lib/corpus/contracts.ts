import type { YouProfile } from "../youProfile";

export type CorpusUser = Readonly<{
  id: string | null;
  displayName: string | null;
  timezone: string;
  lat: number | null;
  lon: number | null;
  country: string | null;
  temperatureUnit: "C" | "F" | null;
  greetingStyle: "classic" | "humor" | "facts" | "mix" | null;
  includePhysicalActivities: boolean;
  onboardingCompleted: boolean;
  locationPrompted: boolean;
  identity: Record<string, unknown> | null;
}>;

export type CorpusLine = Readonly<{
  sourceId: string;
  side: "deposit" | "withdrawal";
  sort: number;
  label: string;
  labelHash: string;
  plannedCost: number;
  actualCost: number | null;
  completed: boolean;
  completedAt: string | null;
  difficulty: number | null;
  details: string | null;
}>;

export type CorpusDay = Readonly<{
  sourceId: string;
  date: string;
  startedAt: string;
  closedAt: string | null;
  openingBalance: number;
  closingBalance: number | null;
  projectedClosing: number;
  availableCapacity: number;
  phase: "plan" | "audit" | "closed";
  feelRating: number | null;
  weather: Record<string, unknown> | null;
  isHoliday: boolean;
  attwood: unknown;
  journal: string | null;
  compensateNote: string | null;
  legacyQualitative: { ciphertext: string; iv: string } | null;
  lines: readonly CorpusLine[];
}>;

export type TrainingCorpus = Readonly<{
  schemaVersion: 6 | 7;
  exportedAt: string;
  purpose?: string;
  user: CorpusUser;
  youProfile: YouProfile | null;
  youProfileUpdatedAt: string;
  days: readonly CorpusDay[];
  catalog: readonly {
    id: string;
    side: string;
    label: string;
    labelHash: string;
    typicalCost: number;
    weekdayMask: number;
    useCount: number;
    typicalDifficulty: number | null;
    difficultyCount: number;
    lastUsed: string;
  }[];
}>;

export type RestoreMode = "merge" | "replace";
export type ActiveDayResolution = "keep-current" | "replace-current";

export type CorpusPreview = Readonly<{
  daysToAdd: number;
  daysExisting: number;
  linesToAdd: number;
  linesExisting: number;
  hasImportedProfile: boolean;
  activeDayConflict: boolean;
  currentActiveSourceId: string | null;
  importedActiveSourceId: string | null;
}>;

export type RestoreResult = Readonly<{
  ok: true;
  profileRestored: boolean;
  daysAdded: number;
  daysExisting: number;
  daysSkippedForActiveConflict: number;
  linesAdded: number;
  linesExisting: number;
}>;
