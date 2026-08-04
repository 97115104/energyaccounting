import { decryptText, encryptText, getSessionDek } from "./crypto";
import { api } from "./api";
import type { CatalogEntry } from "./butterflyTraits";
import { loadPersonalData } from "./personalData";
import { decryptYouProfile, encryptYouProfile, normalizeYouProfile, type YouProfile } from "./youProfile";

export const CORPUS_SCHEMA_VERSION = 7;

type ExportLine = {
  id: string;
  sourceId?: string;
  side: "deposit" | "withdrawal";
  sort: number;
  labelCiphertext: string;
  labelIv: string;
  labelHash: string;
  plannedCost: number;
  actualCost: number | null;
  completed: boolean;
  completedAt?: string | null;
  difficulty: number | null;
  detailsCiphertext: string | null;
  detailsIv: string | null;
};

type ExportDay = {
  id: string;
  sourceId?: string;
  date: string;
  startedAt: string;
  closedAt?: string | null;
  openingBalance: number;
  closingBalance: number | null;
  projectedClosing: number;
  availableCapacity: number;
  phase: "plan" | "audit" | "closed";
  feelRating: number | null;
  weather: Record<string, unknown> | null;
  isHoliday: boolean;
  attwood: unknown;
  journalCiphertext: string | null;
  journalIv: string | null;
  qualitativeCiphertext?: string | null;
  qualitativeIv?: string | null;
  compensateNoteCiphertext: string | null;
  compensateNoteIv: string | null;
  lines: ExportLine[];
};

type ExportPayload = {
  schemaVersion: number;
  exportedAt: string;
  user: Record<string, unknown>;
  days: ExportDay[];
  catalog: Array<{
    id: string;
    side: string;
    labelCiphertext: string;
    labelIv: string;
    labelHash: string;
    typicalCost: number;
    weekdayMask: number;
    useCount: number;
    typicalDifficulty: number | null;
    difficultyCount: number;
    lastUsed: string;
  }>;
};

export type CorpusUser = {
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
};

export type CorpusLine = {
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
};

export type CorpusDay = {
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
  /** Opaque retired data retained solely for same-key archival restores. */
  legacyQualitative: { ciphertext: string; iv: string } | null;
  lines: CorpusLine[];
};

export type TrainingCorpus = {
  schemaVersion: 6 | 7;
  exportedAt: string;
  purpose?: string;
  user: CorpusUser;
  youProfile: YouProfile | null;
  youProfileUpdatedAt: string;
  days: CorpusDay[];
  catalog: Array<{
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
  }>;
};

export type RestoreMode = "merge" | "replace";
export type ActiveDayResolution = "keep-current" | "replace-current";

export type CorpusPreview = {
  daysToAdd: number;
  daysExisting: number;
  linesToAdd: number;
  linesExisting: number;
  hasImportedProfile: boolean;
  activeDayConflict: boolean;
  currentActiveSourceId: string | null;
  importedActiveSourceId: string | null;
};

export type RestoreResult = {
  ok: true;
  profileRestored: boolean;
  daysAdded: number;
  daysExisting: number;
  daysSkippedForActiveConflict: number;
  linesAdded: number;
  linesExisting: number;
};

type RestoreWire = {
  schemaVersion: 7;
  mode: RestoreMode;
  activeDayResolution?: ActiveDayResolution;
  user: Omit<CorpusUser, "id">;
  youProfile: { ciphertext: string; iv: string; updatedAt: string } | null;
  days: Array<{
    sourceId: string;
    date: string;
    startedAt: string;
    closedAt: string | null;
    openingBalance: number;
    phase: CorpusDay["phase"];
    feelRating: number | null;
    weather: Record<string, unknown> | null;
    isHoliday: boolean;
    journalCiphertext: string | null;
    journalIv: string | null;
    compensateNoteCiphertext: string | null;
    compensateNoteIv: string | null;
    legacyQualitative: { ciphertext: string; iv: string } | null;
    lines: Array<{
      sourceId: string;
      side: CorpusLine["side"];
      sort: number;
      labelCiphertext: string;
      labelIv: string;
      labelHash: string;
      plannedCost: number;
      actualCost: number | null;
      completed: boolean;
      completedAt: string | null;
      difficulty: number | null;
      detailsCiphertext: string | null;
      detailsIv: string | null;
    }>;
  }>;
};

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function string(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  return value;
}

function nullableString(value: unknown, message: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, message);
}

function number(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function nullableNumber(value: unknown, message: string): number | null {
  if (value === null || value === undefined) return null;
  return number(value, message);
}

function boolean(value: unknown, fallback: boolean, message: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function timestamp(value: unknown, message: string): string {
  const out = string(value, message);
  if (Number.isNaN(Date.parse(out))) throw new Error(message);
  return out;
}

function maybeTimestamp(value: unknown, fallback: string | null, message: string): string | null {
  if (value === null || value === undefined) return fallback;
  return timestamp(value, message);
}

function nullableRecord(value: unknown, message: string): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  return record(value, message);
}

function phase(value: unknown): CorpusDay["phase"] {
  if (value === "plan" || value === "audit" || value === "closed") return value;
  throw new Error("Each day must have a valid phase.");
}

function side(value: unknown): CorpusLine["side"] {
  if (value === "deposit" || value === "withdrawal") return value;
  throw new Error("Each task must be an add-energy or use-energy item.");
}

function sourceId(value: unknown, fallback: unknown, message: string): string {
  const out = typeof value === "string" ? value : string(fallback, message);
  if (!out.trim()) throw new Error(message);
  return out;
}

function nullablePair(
  ciphertext: unknown,
  iv: unknown,
  message: string,
): { ciphertext: string; iv: string } | null {
  const ct = nullableString(ciphertext, message);
  const nonce = nullableString(iv, message);
  if ((ct === null) !== (nonce === null)) throw new Error(message);
  return ct === null || nonce === null ? null : { ciphertext: ct, iv: nonce };
}

function parseUser(raw: unknown, schemaVersion: 6 | 7): CorpusUser {
  const user = record(raw, "The corpus user profile is invalid.");
  const temperatureUnit = user.temperatureUnit;
  const greetingStyle = user.greetingStyle;
  if (temperatureUnit !== undefined && temperatureUnit !== null && temperatureUnit !== "C" && temperatureUnit !== "F") {
    throw new Error("The corpus temperature preference is invalid.");
  }
  if (
    greetingStyle !== undefined &&
    greetingStyle !== null &&
    greetingStyle !== "classic" &&
    greetingStyle !== "humor" &&
    greetingStyle !== "facts" &&
    greetingStyle !== "mix"
  ) {
    throw new Error("The corpus greeting preference is invalid.");
  }
  return {
    id: nullableString(user.id, "The corpus user id is invalid."),
    displayName: nullableString(user.displayName, "The corpus display name is invalid."),
    timezone: typeof user.timezone === "string" && user.timezone.trim() ? user.timezone : "UTC",
    lat: nullableNumber(user.lat, "The corpus latitude is invalid."),
    lon: nullableNumber(user.lon, "The corpus longitude is invalid."),
    country: nullableString(user.country, "The corpus country is invalid."),
    temperatureUnit: (temperatureUnit ?? null) as CorpusUser["temperatureUnit"],
    greetingStyle: (greetingStyle ?? null) as CorpusUser["greetingStyle"],
    includePhysicalActivities: boolean(user.includePhysicalActivities, true, "The movement preference is invalid."),
    // v6 predates these settings. A journal export is already a returning
    // account, so preserve a smooth restore rather than replay onboarding.
    onboardingCompleted: boolean(user.onboardingCompleted, schemaVersion === 6, "The onboarding preference is invalid."),
    locationPrompted: boolean(user.locationPrompted, schemaVersion === 6, "The location preference is invalid."),
    identity: nullableRecord(user.identity, "The corpus identity is invalid."),
  };
}

function parseLine(raw: unknown, dayClosedAt: string | null): CorpusLine {
  const line = record(raw, "A corpus task is invalid.");
  const completed = boolean(line.completed, false, "A task completion value is invalid.");
  return {
    sourceId: sourceId(line.sourceId, line.id, "A corpus task is missing its source id."),
    side: side(line.side),
    sort: number(line.sort, "A task sort order is invalid."),
    label: string(line.label, "A corpus task label is invalid."),
    labelHash: string(line.labelHash, "A corpus task label hash is invalid."),
    plannedCost: number(line.plannedCost, "A task planned cost is invalid."),
    actualCost: nullableNumber(line.actualCost, "A task actual cost is invalid."),
    completed,
    completedAt: maybeTimestamp(
      line.completedAt,
      completed ? (dayClosedAt ?? null) : null,
      "A task completion timestamp is invalid.",
    ),
    difficulty: nullableNumber(line.difficulty, "A task difficulty is invalid."),
    details: nullableString(line.details, "A task detail is invalid."),
  };
}

function parseDay(raw: unknown): CorpusDay {
  const day = record(raw, "A corpus day is invalid.");
  const parsedPhase = phase(day.phase);
  const startedAt = timestamp(day.startedAt, "A day start timestamp is invalid.");
  const closedAt = maybeTimestamp(
    day.closedAt,
    parsedPhase === "closed" ? startedAt : null,
    "A day close timestamp is invalid.",
  );
  const rawLines = day.lines;
  if (!Array.isArray(rawLines)) throw new Error("A corpus day needs a task list.");
  const legacy = day.legacyQualitative === undefined
    ? nullablePair(day.qualitativeCiphertext, day.qualitativeIv, "Legacy archive data is incomplete.")
    : (() => {
        if (day.legacyQualitative === null) return null;
        const value = record(day.legacyQualitative, "Legacy archive data is invalid.");
        return nullablePair(value.ciphertext, value.iv, "Legacy archive data is incomplete.");
      })();
  const lines = rawLines.map((line) => parseLine(line, closedAt));
  if (new Set(lines.map((line) => line.sourceId)).size !== lines.length) {
    throw new Error("A corpus day contains duplicate task source ids.");
  }
  return {
    sourceId: sourceId(day.sourceId, day.id, "A corpus day is missing its source id."),
    date: string(day.date, "A corpus date is invalid."),
    startedAt,
    closedAt,
    openingBalance: number(day.openingBalance, "A day opening balance is invalid."),
    closingBalance: nullableNumber(day.closingBalance, "A day closing balance is invalid."),
    projectedClosing: number(day.projectedClosing, "A day projected balance is invalid."),
    availableCapacity: number(day.availableCapacity, "A day available capacity is invalid."),
    phase: parsedPhase,
    feelRating: nullableNumber(day.feelRating, "A day rating is invalid."),
    weather: nullableRecord(day.weather, "A day weather record is invalid."),
    isHoliday: boolean(day.isHoliday, false, "A day holiday value is invalid."),
    attwood: day.attwood ?? null,
    journal: nullableString(day.journal, "A day journal is invalid."),
    compensateNote: nullableString(day.compensateNote, "A recovery note is invalid."),
    legacyQualitative: legacy,
    lines,
  };
}

function parseCatalog(raw: unknown): TrainingCorpus["catalog"] {
  if (!Array.isArray(raw)) throw new Error("The corpus catalog is invalid.");
  return raw.map((entry) => {
    const item = record(entry, "A corpus catalog entry is invalid.");
    return {
      id: string(item.id, "A corpus catalog id is invalid."),
      side: string(item.side, "A corpus catalog side is invalid."),
      label: string(item.label, "A corpus catalog label is invalid."),
      labelHash: string(item.labelHash, "A corpus catalog label hash is invalid."),
      typicalCost: number(item.typicalCost, "A corpus catalog cost is invalid."),
      weekdayMask: number(item.weekdayMask, "A corpus catalog weekday mask is invalid."),
      useCount: number(item.useCount, "A corpus catalog use count is invalid."),
      typicalDifficulty: nullableNumber(item.typicalDifficulty, "A corpus catalog difficulty is invalid."),
      difficultyCount: number(item.difficultyCount, "A corpus catalog difficulty count is invalid."),
      lastUsed: string(item.lastUsed, "A corpus catalog date is invalid."),
    };
  });
}

/** Parse a plaintext v6 or v7 JSON corpus before it is sent anywhere. */
export function parseTrainingCorpus(input: unknown): TrainingCorpus {
  const corpus = record(input, "This file is not an Energy Accounting corpus.");
  if (corpus.schemaVersion !== 6 && corpus.schemaVersion !== 7) {
    throw new Error("This corpus version is not supported. Choose a v6 or v7 EAJ corpus.");
  }
  const schemaVersion = corpus.schemaVersion as 6 | 7;
  const exportedAt = timestamp(corpus.exportedAt, "The corpus export timestamp is invalid.");
  if (!Array.isArray(corpus.days)) throw new Error("The corpus does not contain a day list.");
  const days = corpus.days.map(parseDay);
  if (new Set(days.map((day) => day.sourceId)).size !== days.length) {
    throw new Error("The corpus contains duplicate day source ids.");
  }
  if (days.filter((day) => day.phase !== "closed").length > 1) {
    throw new Error("A corpus may contain only one active energy day.");
  }
  const profileRaw = corpus.youProfile;
  return {
    schemaVersion,
    exportedAt,
    ...(typeof corpus.purpose === "string" ? { purpose: corpus.purpose } : {}),
    user: parseUser(corpus.user, schemaVersion),
    youProfile: profileRaw === null || profileRaw === undefined ? null : normalizeYouProfile(profileRaw),
    youProfileUpdatedAt: maybeTimestamp(
      corpus.youProfileUpdatedAt,
      exportedAt,
      "The You profile timestamp is invalid.",
    ) ?? exportedAt,
    days,
    catalog: parseCatalog(corpus.catalog),
  };
}

/** Read and validate a selected corpus locally; no corpus text has left the device. */
export async function readTrainingCorpus(file: File): Promise<TrainingCorpus> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  return parseTrainingCorpus(parsed);
}

export function corpusPreviewRequest(corpus: TrainingCorpus) {
  return {
    days: corpus.days.map((day) => ({
      sourceId: day.sourceId,
      phase: day.phase,
      lineSourceIds: day.lines.map((line) => line.sourceId),
    })),
    hasProfile: corpus.youProfile !== null,
  };
}

/** Ask the server only for an ID-based diff, never for the plaintext corpus. */
export async function previewTrainingCorpus(corpus: TrainingCorpus): Promise<CorpusPreview> {
  return api<CorpusPreview>("/api/import/corpus/preview", {
    method: "POST",
    body: JSON.stringify(corpusPreviewRequest(corpus)),
  });
}

async function encryptOptional(
  dek: CryptoKey,
  value: string | null,
  aad: string,
): Promise<{ ciphertext: string | null; iv: string | null }> {
  if (value === null) return { ciphertext: null, iv: null };
  const encrypted = await encryptText(dek, value, aad);
  return encrypted;
}

/** Re-encrypt every private text field to the currently unlocked account DEK. */
export async function prepareCorpusRestore(
  corpus: TrainingCorpus,
  mode: RestoreMode,
  activeDayResolution?: ActiveDayResolution,
): Promise<RestoreWire> {
  const dek = getSessionDek();
  if (!dek) throw new Error("Unlock your journal key before restoring.");
  const days: RestoreWire["days"] = [];
  for (const day of corpus.days) {
    const journal = await encryptOptional(dek, day.journal, "eaj-journal");
    const compensate = await encryptOptional(dek, day.compensateNote, "eaj-compensate");
    const lines: RestoreWire["days"][number]["lines"] = [];
    for (const line of day.lines) {
      const label = await encryptText(dek, line.label, "eaj-label");
      const details = await encryptOptional(dek, line.details, "eaj-task-details");
      lines.push({
        sourceId: line.sourceId,
        side: line.side,
        sort: line.sort,
        labelCiphertext: label.ciphertext,
        labelIv: label.iv,
        labelHash: line.labelHash,
        plannedCost: line.plannedCost,
        actualCost: line.actualCost,
        completed: line.completed,
        completedAt: line.completedAt,
        difficulty: line.difficulty,
        detailsCiphertext: details.ciphertext,
        detailsIv: details.iv,
      });
    }
    days.push({
      sourceId: day.sourceId,
      date: day.date,
      startedAt: day.startedAt,
      closedAt: day.closedAt,
      openingBalance: day.openingBalance,
      phase: day.phase,
      feelRating: day.feelRating,
      weather: day.weather,
      isHoliday: day.isHoliday,
      journalCiphertext: journal.ciphertext,
      journalIv: journal.iv,
      compensateNoteCiphertext: compensate.ciphertext,
      compensateNoteIv: compensate.iv,
      legacyQualitative: day.legacyQualitative,
      lines,
    });
  }
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    mode,
    ...(activeDayResolution ? { activeDayResolution } : {}),
    user: {
      displayName: corpus.user.displayName,
      timezone: corpus.user.timezone,
      lat: corpus.user.lat,
      lon: corpus.user.lon,
      country: corpus.user.country,
      temperatureUnit: corpus.user.temperatureUnit,
      greetingStyle: corpus.user.greetingStyle,
      includePhysicalActivities: corpus.user.includePhysicalActivities,
      onboardingCompleted: corpus.user.onboardingCompleted,
      locationPrompted: corpus.user.locationPrompted,
      identity: corpus.user.identity,
    },
    youProfile: corpus.youProfile
      ? { ...(await encryptYouProfile(dek, corpus.youProfile)), updatedAt: corpus.youProfileUpdatedAt }
      : null,
    days,
  };
}

export async function restoreTrainingCorpus(
  corpus: TrainingCorpus,
  mode: RestoreMode,
  activeDayResolution?: ActiveDayResolution,
): Promise<RestoreResult> {
  const body = await prepareCorpusRestore(corpus, mode, activeDayResolution);
  return api<RestoreResult>("/api/import/corpus", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Decrypted activity catalog for on-device intelligence (trait suggestions).
 * Delegates to the shared personal-data loader so there is one decrypt path.
 */
export async function fetchDecryptedCatalog(): Promise<CatalogEntry[]> {
  const data = await loadPersonalData();
  return data.catalog;
}

/** Decrypted You profile for the corpus; failure aborts the backup rather than losing text. */
async function fetchDecryptedYouProfile(
  dek: CryptoKey,
): Promise<{ profile: YouProfile | null; updatedAt: string }> {
  const res = await api<{ profile: { ciphertext: string; iv: string; updatedAt: string } | null }>(
    "/api/you/profile",
  );
  if (!res.profile) return { profile: null, updatedAt: new Date().toISOString() };
  try {
    return { profile: await decryptYouProfile(dek, res.profile.ciphertext, res.profile.iv), updatedAt: res.profile.updatedAt };
  } catch {
    throw new Error("Could not decrypt your You profile. Your corpus was not exported.");
  }
}

async function decryptRequired(
  dek: CryptoKey,
  ciphertext: string | null,
  iv: string | null,
  aad: string,
  description: string,
): Promise<string | null> {
  const pair = nullablePair(ciphertext, iv, `${description} has incomplete encryption data.`);
  if (!pair) return null;
  try {
    return await decryptText(dek, pair.ciphertext, pair.iv, aad);
  } catch {
    throw new Error(`Could not decrypt ${description}. Your corpus was not exported.`);
  }
}

/** Fetch encrypted export, decrypt every current field, and download plaintext JSON. */
export async function downloadTrainingCorpus(): Promise<void> {
  const dek = getSessionDek();
  if (!dek) throw new Error("Unlock your journal key before exporting.");

  const raw = await api<ExportPayload>("/api/export/days");
  const days: CorpusDay[] = [];
  for (const d of raw.days) {
    const closedAt = d.closedAt ?? (d.phase === "closed" ? d.startedAt : null);
    const lines: CorpusLine[] = [];
    for (const l of d.lines) {
      const label = await decryptRequired(dek, l.labelCiphertext, l.labelIv, "eaj-label", "a task label");
      if (label === null) throw new Error("A task label is missing. Your corpus was not exported.");
      lines.push({
        sourceId: l.sourceId ?? l.id,
        side: l.side,
        sort: l.sort,
        label,
        labelHash: l.labelHash,
        plannedCost: l.plannedCost,
        actualCost: l.actualCost,
        completed: l.completed,
        completedAt: l.completedAt ?? (l.completed ? closedAt : null),
        difficulty: l.difficulty,
        details: await decryptRequired(
          dek,
          l.detailsCiphertext,
          l.detailsIv,
          "eaj-task-details",
          "a task detail",
        ),
      });
    }
    days.push({
      sourceId: d.sourceId ?? d.id,
      date: d.date,
      startedAt: d.startedAt,
      closedAt,
      openingBalance: d.openingBalance,
      closingBalance: d.closingBalance,
      projectedClosing: d.projectedClosing,
      availableCapacity: d.availableCapacity,
      phase: d.phase,
      feelRating: d.feelRating,
      weather: d.weather,
      isHoliday: d.isHoliday,
      attwood: d.attwood,
      journal: await decryptRequired(dek, d.journalCiphertext, d.journalIv, "eaj-journal", "a journal entry"),
      compensateNote: await decryptRequired(
        dek,
        d.compensateNoteCiphertext,
        d.compensateNoteIv,
        "eaj-compensate",
        "a recovery note",
      ),
      legacyQualitative: nullablePair(
        d.qualitativeCiphertext,
        d.qualitativeIv,
        "Legacy archive data is incomplete.",
      ),
      lines,
    });
  }

  const catalog = [];
  for (const c of raw.catalog) {
    const label = await decryptRequired(dek, c.labelCiphertext, c.labelIv, "eaj-label", "a catalog label");
    if (label === null) throw new Error("A catalog label is missing. Your corpus was not exported.");
    catalog.push({
      id: c.id,
      side: c.side,
      label,
      labelHash: c.labelHash,
      typicalCost: c.typicalCost,
      weekdayMask: c.weekdayMask,
      useCount: c.useCount,
      typicalDifficulty: c.typicalDifficulty,
      difficultyCount: c.difficultyCount,
      lastUsed: c.lastUsed,
    });
  }

  const youProfile = await fetchDecryptedYouProfile(dek);
  const corpus: TrainingCorpus = {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    exportedAt: raw.exportedAt,
    purpose: "personal energy accounting corpus for optional future model training and restore",
    user: parseUser(raw.user, CORPUS_SCHEMA_VERSION),
    youProfile: youProfile.profile,
    youProfileUpdatedAt: youProfile.updatedAt,
    days,
    catalog,
  };

  const blob = new Blob([JSON.stringify(corpus, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eaj-corpus-${raw.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
