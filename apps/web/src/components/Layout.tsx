import { useState } from "react";
import { Link, Outlet, useOutletContext } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useLiveCount } from "../hooks/useLiveCount.js";
import { useSiteConfig } from "../hooks/useSiteConfig.js";

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
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Link className="mark" to="/">
          passerby
        </Link>
        {online !== null && (
          <span className="count">
            {online} {online === 1 ? "person" : "people"} here now
          </span>
        )}
        <Link className="link" to="/account">
          {auth.user ? auth.user.name : auth.status === "ready" ? "Sign in" : "Account"}
        </Link>
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
