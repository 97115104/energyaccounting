export type ToastKind = "success" | "error" | "info";

export type ToastNotice = Readonly<{
  id: number;
  kind: ToastKind;
  text: string;
}>;

export type ToastAction =
  | Readonly<{ type: "show"; toast: ToastNotice }>
  | Readonly<{ type: "dismiss"; id: number }>;

/** A small pure reducer: notifications never need to change page layout. */
export function toastReducer(
  notices: readonly ToastNotice[],
  action: ToastAction,
): readonly ToastNotice[] {
  switch (action.type) {
    case "show":
      return [...notices.filter((notice) => notice.id !== action.toast.id), action.toast].slice(-3);
    case "dismiss":
      return notices.filter((notice) => notice.id !== action.id);
  }
}
