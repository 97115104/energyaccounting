import { useEffect, useRef, useState } from "react";
import {
  createDraftPersistenceState,
  createSerializedDraftSaver,
  type DraftPersistenceEffect,
  type DraftPersistenceEvent,
  type DraftPersistenceState,
  type SerializedDraftSaver,
} from "./draftPersistence";

export type UseSerializedDraftSaverOptions<T> = Readonly<{
  initialSnapshot: T;
  /** Change this when opening a distinct draft in the same mounted component. */
  sessionKey?: string | number | null;
  persist: (snapshot: T) => Promise<void | T>;
  onCommitted?: (snapshot: T, revision: number) => void;
  onStateChange?: (state: DraftPersistenceState<T>, event: DraftPersistenceEvent<T>) => void;
  onEffect?: (effect: DraftPersistenceEffect<T>, state: DraftPersistenceState<T>) => void;
}>;

export type UseSerializedDraftSaverResult<T> = Readonly<{
  state: DraftPersistenceState<T>;
  edit: (snapshot: T) => DraftPersistenceState<T>;
  save: () => DraftPersistenceState<T>;
  retry: () => DraftPersistenceState<T>;
  requestClose: () => DraftPersistenceState<T>;
}>;

/**
 * React adapter for `createSerializedDraftSaver`. All persistence policy stays
 * in the pure reducer/controller; this hook only bridges controller state into
 * React and refreshes callback references on each render.
 */
export function useSerializedDraftSaver<T>(
  options: UseSerializedDraftSaverOptions<T>,
): UseSerializedDraftSaverResult<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const saverRef = useRef<SerializedDraftSaver<T> | null>(null);
  const sessionKeyRef = useRef(options.sessionKey);
  const [state, setState] = useState<DraftPersistenceState<T>>(() =>
    createDraftPersistenceState(options.initialSnapshot),
  );

  const createSaver = (): SerializedDraftSaver<T> =>
    createSerializedDraftSaver({
      initialSnapshot: optionsRef.current.initialSnapshot,
      persist: (snapshot) => optionsRef.current.persist(snapshot),
      onCommitted: (snapshot, revision) => optionsRef.current.onCommitted?.(snapshot, revision),
      onStateChange: (next, event) => {
        setState(next);
        optionsRef.current.onStateChange?.(next, event);
      },
      onEffect: (effect, next) => optionsRef.current.onEffect?.(effect, next),
    });

  if (!saverRef.current) saverRef.current = createSaver();

  useEffect(() => {
    if (Object.is(sessionKeyRef.current, options.sessionKey)) return;
    sessionKeyRef.current = options.sessionKey;
    saverRef.current?.dispose();
    const next = createSaver();
    saverRef.current = next;
    setState(next.state);
  }, [options.sessionKey]);

  useEffect(
    () => () => {
      saverRef.current?.dispose();
    },
    [],
  );

  return {
    state,
    edit: (snapshot) => saverRef.current!.edit(snapshot),
    save: () => saverRef.current!.save(),
    retry: () => saverRef.current!.retry(),
    requestClose: () => saverRef.current!.requestClose(),
  };
}
