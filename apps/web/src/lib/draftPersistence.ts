/**
 * A functional core for text-like drafts that persist asynchronously.
 *
 * The reducer owns ordering decisions; the controller only interprets the
 * resulting effects. Callers provide immutable snapshots, which lets an
 * in-flight save retain the exact value it was asked to persist while later
 * edits replace the single queued snapshot.
 */

export type DraftToastReason = "saved" | "save-failed" | "close-blocked";

type DraftBase<T> = Readonly<{
  draft: T;
  committed: T;
  /** Monotonically increases for each edit. */
  revision: number;
  /** A close request waits for the current draft to be confirmed. */
  closeRequested: boolean;
}>;

export type DraftPersistenceState<T> =
  | (DraftBase<T> &
      Readonly<{
        status: "clean";
      }>)
  | (DraftBase<T> &
      Readonly<{
        status: "dirty";
      }>)
  | (DraftBase<T> &
      Readonly<{
        status: "saving";
        activeRevision: number;
      }>)
  | (DraftBase<T> &
      Readonly<{
        status: "error";
        failedRevision: number;
        error: string;
      }>);

export type DraftPersistenceEvent<T> =
  | Readonly<{ type: "edit"; snapshot: T }>
  | Readonly<{ type: "save-started"; revision: number }>
  | Readonly<{ type: "save-succeeded"; revision: number; snapshot: T }>
  | Readonly<{ type: "save-failed"; revision: number; error: string }>
  | Readonly<{ type: "retry" }>
  | Readonly<{ type: "close-requested" }>;

export type DraftPersistenceEffect<T> =
  | Readonly<{
      type: "persist-latest";
      snapshot: T;
      revision: number;
    }>
  | Readonly<{
      type: "show-toast";
      tone: "success" | "error";
      reason: DraftToastReason;
    }>
  | Readonly<{ type: "close-dialog" }>;

export type DraftPersistenceTransition<T> = Readonly<{
  state: DraftPersistenceState<T>;
  effects: readonly DraftPersistenceEffect<T>[];
}>;

export function createDraftPersistenceState<T>(initialSnapshot: T): DraftPersistenceState<T> {
  return {
    status: "clean",
    draft: initialSnapshot,
    committed: initialSnapshot,
    revision: 0,
    closeRequested: false,
  };
}

/**
 * Immutably applies a confirmed patch to one in-memory record. Returning the
 * original collection for a missing id keeps unrelated UI selectors stable.
 */
export function mergeRecordById<T extends Readonly<{ id: string }>>(
  records: readonly T[],
  id: string,
  patch: Readonly<Partial<T>>,
): readonly T[] {
  if (!records.some((record) => record.id === id)) return records;
  return records.map((record) =>
    record.id === id ? ({ ...record, ...patch } as T) : record,
  );
}

function transition<T>(
  state: DraftPersistenceState<T>,
  effects: readonly DraftPersistenceEffect<T>[] = [],
): DraftPersistenceTransition<T> {
  return { state, effects };
}

function persistLatest<T>(state: DraftPersistenceState<T>): DraftPersistenceEffect<T> {
  return {
    type: "persist-latest",
    snapshot: state.draft,
    revision: state.revision,
  };
}

function dirtyState<T>(
  state: DraftPersistenceState<T>,
  overrides: Readonly<Partial<Pick<DraftBase<T>, "draft" | "committed" | "revision" | "closeRequested">>> = {},
): DraftPersistenceState<T> {
  return {
    status: "dirty",
    draft: overrides.draft ?? state.draft,
    committed: overrides.committed ?? state.committed,
    revision: overrides.revision ?? state.revision,
    closeRequested: overrides.closeRequested ?? state.closeRequested,
  };
}

/**
 * Pure transition function. It never starts network work, mutates a snapshot,
 * or decides how a toast is rendered. Those are adapters around its effects.
 */
export function reduceDraftPersistence<T>(
  state: DraftPersistenceState<T>,
  event: DraftPersistenceEvent<T>,
): DraftPersistenceTransition<T> {
  switch (event.type) {
    case "edit": {
      // Keep the active request identifiable while its newer replacement waits
      // in the controller. Dropping `saving` here would make that response look
      // stale and prevent the queued latest snapshot from starting.
      if (state.status === "saving") {
        const next: DraftPersistenceState<T> = {
          status: "saving",
          draft: event.snapshot,
          committed: state.committed,
          revision: state.revision + 1,
          closeRequested: false,
          activeRevision: state.activeRevision,
        };
        return transition(next, [persistLatest(next)]);
      }
      const next: DraftPersistenceState<T> = {
        status: "dirty",
        draft: event.snapshot,
        committed: state.committed,
        revision: state.revision + 1,
        closeRequested: false,
      };
      return transition(next, [persistLatest(next)]);
    }

    case "save-started": {
      // A start for an outdated revision must not mask a newer dirty draft.
      if (state.status === "saving" || event.revision !== state.revision) return transition(state);
      return transition({
        status: "saving",
        draft: state.draft,
        committed: state.committed,
        revision: state.revision,
        closeRequested: state.closeRequested,
        activeRevision: event.revision,
      });
    }

    case "save-succeeded": {
      if (state.status !== "saving" || event.revision !== state.activeRevision) return transition(state);

      // A newer edit arrived while this request was in flight. Its snapshot is
      // now the only remaining work; no stale success toast should be shown.
      if (event.revision < state.revision) {
        const next = dirtyState(state, { committed: event.snapshot });
        return transition(next, [persistLatest(next)]);
      }

      const next: DraftPersistenceState<T> = {
        status: "clean",
        draft: event.snapshot,
        committed: event.snapshot,
        revision: state.revision,
        closeRequested: false,
      };
      const effects: DraftPersistenceEffect<T>[] = [
        { type: "show-toast", tone: "success", reason: "saved" },
      ];
      if (state.closeRequested) effects.push({ type: "close-dialog" });
      return transition(next, effects);
    }

    case "save-failed": {
      if (state.status !== "saving" || event.revision !== state.activeRevision) return transition(state);

      // An older failure cannot invalidate the newer draft. Queue that newer
      // snapshot directly and avoid surfacing a stale error to the person.
      if (event.revision < state.revision) {
        const next = dirtyState(state);
        return transition(next, [persistLatest(next)]);
      }

      return transition(
        {
          status: "error",
          draft: state.draft,
          committed: state.committed,
          revision: state.revision,
          closeRequested: state.closeRequested,
          failedRevision: event.revision,
          error: event.error,
        },
        [{ type: "show-toast", tone: "error", reason: "save-failed" }],
      );
    }

    case "retry": {
      if (state.status === "clean" || state.status === "saving") return transition(state);
      const next = dirtyState(state);
      return transition(next, [persistLatest(next)]);
    }

    case "close-requested": {
      if (state.status === "clean") return transition(state, [{ type: "close-dialog" }]);
      if (state.status === "error") {
        return transition(state, [{ type: "show-toast", tone: "error", reason: "close-blocked" }]);
      }
      if (state.status === "saving") {
        return transition({ ...state, closeRequested: true });
      }
      const next = dirtyState(state, { closeRequested: true });
      return transition(next, [persistLatest(next)]);
    }
  }
}

export type SerializedDraftSaverOptions<T> = Readonly<{
  initialSnapshot: T;
  /** Resolves with a canonical snapshot, or void when the submitted snapshot is canonical. */
  persist: (snapshot: T) => Promise<void | T>;
  onCommitted?: (snapshot: T, revision: number) => void;
  onStateChange?: (state: DraftPersistenceState<T>, event: DraftPersistenceEvent<T>) => void;
  onEffect?: (effect: DraftPersistenceEffect<T>, state: DraftPersistenceState<T>) => void;
}>;

export type SerializedDraftSaver<T> = Readonly<{
  readonly state: DraftPersistenceState<T>;
  edit: (snapshot: T) => DraftPersistenceState<T>;
  /** Persists the dirty or failed draft. No-op when clean or already saving. */
  save: () => DraftPersistenceState<T>;
  retry: () => DraftPersistenceState<T>;
  /** Closes immediately when clean; otherwise closes after a confirmed save. */
  requestClose: () => DraftPersistenceState<T>;
  dispose: () => void;
}>;

type PendingSnapshot<T> = Readonly<{ snapshot: T; revision: number }>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not save changes.";
}

/**
 * Effect adapter for the reducer. At most one request is in flight; while it
 * runs, all edits collapse into exactly one latest pending snapshot.
 */
export function createSerializedDraftSaver<T>(
  options: SerializedDraftSaverOptions<T>,
): SerializedDraftSaver<T> {
  let state = createDraftPersistenceState(options.initialSnapshot);
  let inFlight: PendingSnapshot<T> | null = null;
  let pending: PendingSnapshot<T> | null = null;
  let disposed = false;

  const notify = (event: DraftPersistenceEvent<T>) => {
    options.onStateChange?.(state, event);
  };

  const enqueue = (next: PendingSnapshot<T>) => {
    if (disposed) return;
    if (inFlight) {
      // The current request cannot be cancelled safely; retain only the newest
      // immutable snapshot for the next request.
      if (inFlight.revision !== next.revision) pending = next;
      return;
    }
    pending = null;
    inFlight = next;
    dispatch({ type: "save-started", revision: next.revision });
    const finish = (event: DraftPersistenceEvent<T>) => {
      if (disposed || inFlight?.revision !== next.revision) return;
      inFlight = null;
      const queued = pending;
      pending = null;
      dispatch(event);
      // Reducer effects normally start this request. The fallback keeps the
      // controller safe if a caller filters effects in a future adapter.
      if (!inFlight && queued) enqueue(queued);
    };
    let request: Promise<void | T>;
    try {
      request = options.persist(next.snapshot);
    } catch (error) {
      finish({ type: "save-failed", revision: next.revision, error: errorMessage(error) });
      return;
    }
    void request.then(
      (result) => {
        const committed = result === undefined ? next.snapshot : result;
        if (disposed || inFlight?.revision !== next.revision) return;
        options.onCommitted?.(committed, next.revision);
        finish({ type: "save-succeeded", revision: next.revision, snapshot: committed });
      },
      (error: unknown) => {
        finish({ type: "save-failed", revision: next.revision, error: errorMessage(error) });
      },
    );
  };

  const applyEffect = (effect: DraftPersistenceEffect<T>) => {
    options.onEffect?.(effect, state);
    if (effect.type === "persist-latest") {
      enqueue({ snapshot: effect.snapshot, revision: effect.revision });
    }
  };

  const dispatch = (event: DraftPersistenceEvent<T>): DraftPersistenceState<T> => {
    if (disposed) return state;
    const next = reduceDraftPersistence(state, event);
    state = next.state;
    notify(event);
    for (const effect of next.effects) applyEffect(effect);
    return state;
  };

  return {
    get state() {
      return state;
    },
    edit(snapshot) {
      return dispatch({ type: "edit", snapshot });
    },
    save() {
      return dispatch({ type: "retry" });
    },
    retry() {
      return dispatch({ type: "retry" });
    },
    requestClose() {
      return dispatch({ type: "close-requested" });
    },
    dispose() {
      disposed = true;
      pending = null;
    },
  };
}
