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
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { RewardedAd } from "./RewardedAd.js";

/** How long a rewarded ad unlocks the filters for. */
export const UNLOCK_MS = 30 * 60_000;
/** Remembered in this browser, so a reload doesn't lose the time that is left. */
const UNLOCK_KEY = "pb_unlock_until";
const TOAST_MS = 4000;

function readUnlock(): number {
  try {
    const n = Number(localStorage.getItem(UNLOCK_KEY));
    return Number.isFinite(n) && n > Date.now() && n < Date.now() + UNLOCK_MS + 60_000 ? n : 0;
  } catch {
    return 0;
  }
}

interface PlusApi {
  /** Signed in, with Plus active. Plus people see no ads. */
  plus: boolean;
  /** Ads may be drawn for this visitor: they are switched on, and the visitor is known not to be Plus. */
  adsVisible: boolean;
  /** Country and who-to-talk-to are locked for this visitor right now. */
  filtersLocked: boolean;
  /** Open the Plus box. */
  openPlus(): void;
}

const Plus = createContext<PlusApi>({
  plus: false,
  adsVisible: false,
  filtersLocked: false,
  openPlus: () => undefined,
});

/** What the pages need to know about Plus and ads, and how to open the Plus box. */
export const usePlus = () => useContext(Plus);

/**
 * Holds the Plus state for the whole site: whether this visitor is Plus, whether ads may be drawn, whether the
 * filters are locked (and for how long a rewarded ad has unlocked them), and the Plus box and toast themselves.
 */
export function PlusProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { config } = useSiteConfig();
  const [open, setOpen] = useState(false);
  const [until, setUntil] = useState(readUnlock);
  const [, tick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const plus = auth.user?.plus === true;
  const unlocked = until > Date.now();
  const filtersLocked = config.plusFilters && !plus && !unlocked;
  // Wait until we know who is signed in, so a Plus member never sees an ad flash by.
  const adsVisible = config.ads.enabled && !plus && auth.status === "ready";
  const rewardedOffered =
    config.ads.enabled &&
    config.ads.rewarded !== "none" &&
    config.plusFilters &&
    !plus &&
    !unlocked;

  // Lock again when the time is up.
  useEffect(() => {
    if (until <= Date.now()) return;
    const wait = Math.min(until - Date.now() + 50, 2 ** 31 - 1);
    const t = setTimeout(() => tick((n) => n + 1), wait);
    return () => clearTimeout(t);
  }, [until]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const grant = useCallback(() => {
    const end = Date.now() + UNLOCK_MS;
    try {
      localStorage.setItem(UNLOCK_KEY, String(end));
    } catch {
      /* the unlock still works for this visit */
    }
    setUntil(end);
    setOpen(false);
    setToast("filters unlocked for 30 min ✓");
  }, []);

  const api = useMemo<PlusApi>(
    () => ({ plus, adsVisible, filtersLocked, openPlus: () => setOpen(true) }),
    [plus, adsVisible, filtersLocked],
  );

  return (
    <Plus.Provider value={api}>
      {children}
      {open &&
        createPortal(
          <PlusModal
            checkout={config.plusCheckout}
            rewarded={rewardedOffered}
            onClose={() => setOpen(false)}
            onUnlocked={grant}
          />,
          document.body,
        )}
      {toast && (
        <p className="toast" role="status">
          {toast}
        </p>
      )}
    </Plus.Provider>
  );
}

interface ModalProps {
  checkout: boolean;
  rewarded: boolean;
  onClose(): void;
  onUnlocked(): void;
}

/** The Plus box: what Plus is, the main button, and (for free visitors) a rewarded ad as the other way in. */
function PlusModal({ checkout, rewarded, onClose, onUnlocked }: ModalProps) {
  const [view, setView] = useState<"offer" | "ad">("offer");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (view === "ad") setView("offer");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  return (
    <div
      className="plus-back"
      data-plus-modal=""
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="plus"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plus-title"
        tabIndex={-1}
        ref={box}
      >
        <div className="plus-head">
          <h2 id="plus-title">Passerby Plus ✦</h2>
          <button type="button" className="xbtn" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {view === "offer" ? (
          <>
            <ul className="plus-list">
              <li>Zero ads, anywhere</li>
              <li>Choose countries to talk to</li>
              <li>Talk to guys or girls</li>
            </ul>
            <button type="button" className="btn go plus-main" disabled={!checkout}>
              try 7 days free
            </button>
            {!checkout && (
              <p className="hint">Plus isn&rsquo;t on sale yet. It&rsquo;s coming soon.</p>
            )}
            {rewarded && (
              <>
                <div className="plus-or" role="separator">
                  <span>or</span>
                </div>
                <button type="button" className="plus-rewarded" onClick={() => setView("ad")}>
                  ▶ watch a short ad · unlock filters for 30 min
                </button>
              </>
            )}
          </>
        ) : (
          <RewardedAd onComplete={onUnlocked} onClose={() => setView("offer")} />
        )}
      </div>
    </div>
  );
}
