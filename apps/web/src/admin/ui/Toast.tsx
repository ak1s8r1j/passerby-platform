import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface ToastInput {
  text: string;
  /** Shows an Undo button. The toast offers it for a few seconds; after that the action stands. */
  undo?: () => void | Promise<void>;
  tone?: "default" | "error";
}

interface Shown extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ show(t: ToastInput): void } | null>(null);

/** How long a message stays: long enough to read it and to change your mind. */
export const TOAST_MS = 7000;
export const ERROR_TOAST_MS = 9000;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx.show;
}

/**
 * One message at a time at the bottom of the screen. Confirming a change afterwards, with a way back, is
 * kinder than asking "are you sure?" before it: people act at once and can undo slips.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const next = useRef(1);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const arm = useCallback(
    (ms: number) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(hide, ms);
    },
    [hide],
  );

  const show = useCallback(
    (t: ToastInput) => {
      setToast({ ...t, id: next.current++ });
      arm(t.tone === "error" ? ERROR_TOAST_MS : TOAST_MS);
    },
    [arm],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  const value = useMemo(() => ({ show }), [show]);

  const undo = async () => {
    const run = toast?.undo;
    hide();
    try {
      await run?.();
    } catch (err) {
      show({
        text: err instanceof Error ? err.message : "That couldn't be undone.",
        tone: "error",
      });
    }
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* The region is always there, so screen readers pick up what appears in it. */}
      <div className="adm adm-toasts" role="status" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            className={`adm-toast${toast.tone === "error" ? " bad" : ""}`}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={() => arm(2500)}
          >
            <span>{toast.text}</span>
            {toast.undo && (
              <button type="button" className="adm-toast-btn" onClick={() => void undo()}>
                Undo
              </button>
            )}
            <button type="button" className="adm-toast-x" aria-label="Dismiss" onClick={hide}>
              ×
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
