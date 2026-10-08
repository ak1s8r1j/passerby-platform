import { useState } from "react";
import { Link, Outlet, useOutletContext } from "react-router-dom";
import { useLiveCount } from "../hooks/useLiveCount.js";

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
      </header>
      <main id="main">
        <Outlet context={{ setLiveCount } satisfies LayoutContext} />
      </main>
      <footer>
        <span>© {new Date().getFullYear()} Passerby</span>
      </footer>
    </>
  );
}
