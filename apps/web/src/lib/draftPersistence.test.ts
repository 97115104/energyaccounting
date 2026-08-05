import { describe, expect, test } from "bun:test";
import {
  createDraftPersistenceState,
  createSerializedDraftSaver,
  mergeRecordById,
  reduceDraftPersistence,
  type DraftPersistenceEffect,
} from "./draftPersistence";

type Snapshot = Readonly<{ text: string }>;

const snapshot = (text: string): Snapshot => ({ text });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("reduceDraftPersistence", () => {
  test("merges a confirmed record without mutating unrelated entries", () => {
    const records: readonly Readonly<{ id: string; text: string; ciphertext: string | null }>[] = [
      { id: "first", text: "before", ciphertext: null as string | null },
      { id: "second", text: "keep", ciphertext: "existing" },
    ];

    const merged = mergeRecordById(records, "first", { text: "after", ciphertext: "cipher" });

    expect(merged).toEqual([
      { id: "first", text: "after", ciphertext: "cipher" },
      { id: "second", text: "keep", ciphertext: "existing" },
    ]);
    expect(merged).not.toBe(records);
    expect(merged[1]).toBe(records[1]);
    expect(mergeRecordById(records, "missing", { text: "ignored" })).toBe(records);
  });

  test("describes an edit as immutable persistence work", () => {
    const initial = createDraftPersistenceState(snapshot("before"));
    const next = reduceDraftPersistence(initial, { type: "edit", snapshot: snapshot("after") });

    expect(initial).toEqual(createDraftPersistenceState(snapshot("before")));
    expect(next.state).toMatchObject({ status: "dirty", draft: snapshot("after"), revision: 1 });
    expect(next.effects).toEqual([
      { type: "persist-latest", snapshot: snapshot("after"), revision: 1 },
    ]);
  });

  test("queues the newest revision after an older successful save", () => {
    const edited = reduceDraftPersistence(createDraftPersistenceState(snapshot("one")), {
      type: "edit",
      snapshot: snapshot("two"),
    }).state;
    const saving = reduceDraftPersistence(edited, { type: "save-started", revision: 1 }).state;
    const newer = reduceDraftPersistence(saving, { type: "edit", snapshot: snapshot("three") }).state;
    const result = reduceDraftPersistence(newer, {
      type: "save-succeeded",
      revision: 1,
      snapshot: snapshot("two"),
    });

    expect(result.state).toMatchObject({
      status: "dirty",
      draft: snapshot("three"),
      committed: snapshot("two"),
      revision: 2,
    });
    expect(result.effects).toEqual([
      { type: "persist-latest", snapshot: snapshot("three"), revision: 2 },
    ]);
  });

  test("keeps a close request through failure and closes after retry succeeds", () => {
    const edited = reduceDraftPersistence(createDraftPersistenceState(snapshot("old")), {
      type: "edit",
      snapshot: snapshot("new"),
    }).state;
    const closeRequested = reduceDraftPersistence(edited, { type: "close-requested" });
    const saving = reduceDraftPersistence(closeRequested.state, { type: "save-started", revision: 1 }).state;
    const failed = reduceDraftPersistence(saving, {
      type: "save-failed",
      revision: 1,
      error: "Network unavailable",
    });
    const retried = reduceDraftPersistence(failed.state, { type: "retry" });
    const retrySaving = reduceDraftPersistence(retried.state, { type: "save-started", revision: 1 }).state;
    const saved = reduceDraftPersistence(retrySaving, {
      type: "save-succeeded",
      revision: 1,
      snapshot: snapshot("new"),
    });

    expect(closeRequested.effects).toEqual([
      { type: "persist-latest", snapshot: snapshot("new"), revision: 1 },
    ]);
    expect(failed.state).toMatchObject({ status: "error", closeRequested: true, error: "Network unavailable" });
    expect(failed.effects).toEqual([{ type: "show-toast", tone: "error", reason: "save-failed" }]);
    expect(retried.effects).toEqual([{ type: "persist-latest", snapshot: snapshot("new"), revision: 1 }]);
    expect(saved.effects).toEqual([
      { type: "show-toast", tone: "success", reason: "saved" },
      { type: "close-dialog" },
    ]);
  });
});

describe("createSerializedDraftSaver", () => {
  test("keeps one request in flight and persists only the latest queued snapshot", async () => {
    const requests: ReturnType<typeof deferred<void>>[] = [];
    const committed: Snapshot[] = [];
    const effects: DraftPersistenceEffect<Snapshot>[] = [];
    const saver = createSerializedDraftSaver<Snapshot>({
      initialSnapshot: snapshot("start"),
      persist: () => {
        const request = deferred<void>();
        requests.push(request);
        return request.promise;
      },
      onCommitted: (value) => committed.push(value),
      onEffect: (effect) => effects.push(effect),
    });

    saver.edit(snapshot("first"));
    saver.edit(snapshot("second"));
    saver.edit(snapshot("latest"));
    expect(requests).toHaveLength(1);

    requests[0]!.resolve();
    await flushPromises();
    expect(requests).toHaveLength(2);

    requests[1]!.resolve();
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(committed).toEqual([snapshot("first"), snapshot("latest")]);
    expect(saver.state).toMatchObject({ status: "clean", draft: snapshot("latest") });
    expect(effects.filter((effect) => effect.type === "show-toast")).toEqual([
      { type: "show-toast", tone: "success", reason: "saved" },
    ]);
  });

  test("does not close until the pending save is confirmed", async () => {
    const request = deferred<void>();
    const effects: DraftPersistenceEffect<Snapshot>[] = [];
    const saver = createSerializedDraftSaver<Snapshot>({
      initialSnapshot: snapshot(""),
      persist: () => request.promise,
      onEffect: (effect) => effects.push(effect),
    });

    saver.edit(snapshot("note"));
    saver.requestClose();
    expect(effects.some((effect) => effect.type === "close-dialog")).toBe(false);

    request.resolve();
    await flushPromises();
    expect(effects).toContainEqual({ type: "close-dialog" });
  });

  test("retains an error until an explicit retry succeeds", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    let calls = 0;
    const saver = createSerializedDraftSaver<Snapshot>({
      initialSnapshot: snapshot(""),
      persist: () => (calls++ === 0 ? first.promise : second.promise),
    });

    saver.edit(snapshot("retry me"));
    first.reject(new Error("Offline"));
    await flushPromises();
    expect(saver.state).toMatchObject({ status: "error", error: "Offline" });

    saver.retry();
    expect(saver.state.status).toBe("saving");
    second.resolve();
    await flushPromises();
    expect(saver.state).toMatchObject({ status: "clean", draft: snapshot("retry me") });
  });

  test("turns a synchronously thrown transport adapter into a retryable error", () => {
    const saver = createSerializedDraftSaver<Snapshot>({
      initialSnapshot: snapshot(""),
      persist: () => {
        throw new Error("Missing session key");
      },
    });

    saver.edit(snapshot("private note"));

    expect(saver.state).toMatchObject({ status: "error", error: "Missing session key" });
  });
});
