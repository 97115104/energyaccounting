import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { toastReducer, type ToastKind, type ToastNotice } from "../lib/toast";

type ToastInput = Readonly<{
  kind?: ToastKind;
  text: string;
}>;

type ToastContextValue = Readonly<{
  showToast: (input: ToastInput) => void;
}>;

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_DURATION_MS = 2_600;

export function ToastProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [notices, dispatch] = useReducer(toastReducer, []);
  const nextIdRef = useRef(0);

  const showToast = useCallback((input: ToastInput) => {
    const toast: ToastNotice = {
      id: ++nextIdRef.current,
      kind: input.kind ?? "success",
      text: input.text,
    };
    dispatch({ type: "show", toast });
  }, []);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((notice) =>
      window.setTimeout(() => dispatch({ type: "dismiss", id: notice.id }), TOAST_DURATION_MS),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [notices]);

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`guide-toast toast-${notice.kind}`}
            role={notice.kind === "error" ? "alert" : "status"}
          >
            {notice.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
