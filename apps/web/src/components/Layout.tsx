import { useState } from "react";
import { Link, Outlet, useOutletContext } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useLiveCount } from "../hooks/useLiveCount.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { useTheme } from "../hooks/useTheme.js";

/** What a page inside the layout can use. */
export interface LayoutContext {
  /** A page with an open chat connection reports its live count here (null when it has none). */
  setLiveCount(n: number | null): void;
}
export const useLayout = () => useOutletContext<LayoutContext>();

export function Layout() {
  const polled = useLiveCount();
  // The chat connection hears about changes instantly; the poll is only a fallback for other pages.
  const [live, setLiveCount] = useState<number | null>(null);
  const online = live ?? polled;
  const auth = useAuth();
  const { config } = useSiteConfig();
  const { theme, toggle } = useTheme();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Link className="mark" to="/">
          passerby
        </Link>
        <button
          type="button"
          role="switch"
          aria-checked={theme === "dark"}
          aria-label="Dark mode"
          className="theme-toggle"
          onClick={toggle}
        >
          <span className="theme-knob" aria-hidden="true" />
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="ti sun">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path
              d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="ti moon">
            <path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="currentColor" />
          </svg>
        </button>
        {online !== null && (
          <span className="count">
            {online} {online === 1 ? "person" : "people"} here now
          </span>
        )}
        {config.accountLink && (
          <Link className="link" to="/account">
            {auth.user ? auth.user.name : auth.status === "ready" ? "Sign in" : "Account"}
          </Link>
        )}
      </header>
      <main id="main">
        <Outlet context={{ setLiveCount } satisfies LayoutContext} />
      </main>
      <footer>
        <span>
          © {new Date().getFullYear()} {config.name}
        </span>
        <Link to="/rules">Rules</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </>
  );
}
