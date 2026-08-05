import { describe, expect, test } from "bun:test";
import { toastReducer, type ToastNotice } from "./toast";

const saved: ToastNotice = { id: 1, kind: "success", text: "Column switched." };
const failed: ToastNotice = { id: 2, kind: "error", text: "Could not save task details." };

describe("toastReducer", () => {
  test("adds notices immutably and replaces an identical id", () => {
    const first = toastReducer([], { type: "show", toast: saved });
    const next = toastReducer(first, { type: "show", toast: { ...saved, text: "Saved." } });

    expect(first).toEqual([saved]);
    expect(next).toEqual([{ ...saved, text: "Saved." }]);
    expect(next).not.toBe(first);
  });

  test("dismisses only the matching notice", () => {
    expect(toastReducer([saved, failed], { type: "dismiss", id: saved.id })).toEqual([failed]);
  });

  test("retains only the newest three notices so feedback cannot cover controls", () => {
    const notices = [saved, failed, { id: 3, kind: "info" as const, text: "Third." }];
    expect(toastReducer(notices, { type: "show", toast: { id: 4, kind: "success", text: "Fourth." } }))
      .toEqual([failed, { id: 3, kind: "info", text: "Third." }, { id: 4, kind: "success", text: "Fourth." }]);
  });
});
