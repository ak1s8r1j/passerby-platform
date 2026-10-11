import { useEffect, useRef, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAdmin, useOverview } from "./AdminContext.js";
import { Activity } from "./pages/Activity.js";
import { Bans } from "./pages/Bans.js";
import { Overview } from "./pages/Overview.js";
import { Reports } from "./pages/Reports.js";
import { System } from "./pages/System.js";
import { Users } from "./pages/Users.js";
import { Icon, type IconName } from "./ui/Icon.js";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/admin", label: "Overview", icon: "overview", end: true },
  { to: "/admin/reports", label: "Reports", icon: "reports" },
  { to: "/admin/bans", label: "Bans", icon: "bans" },
  { to: "/admin/users", label: "Users", icon: "users" },
  { to: "/admin/activity", label: "Activity", icon: "activity" },
  { to: "/admin/system", label: "System", icon: "system" },
];

/**
 * The admin area's chrome: a translucent sidebar (a bar along the bottom on a phone), and a top bar
 * that shows a hairline and the section name only once the page has scrolled under it.
 */
export function Frame() {
  const admin = useAdmin();
  const overview = useOverview();
  const location = useLocation();
  const open = overview.data?.totals.openReports ?? 0;

  const here = NAV.find((n) =>
    n.end ? location.pathname.replace(/\/$/, "") === n.to : location.pathname.startsWith(n.to),
  );

  // The top bar's hairline appears when content has scrolled under it, instead of always being there.
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!entry!.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A moving content area should start at the top when you change section.
  useEffect(() => {
    window.scrollTo?.({ top: 0 });
  }, [location.pathname]);

  const badge = (label: string) =>
    label === "Reports" && open > 0 ? (
      <span className="adm-badge" aria-label={`${open} open`}>
        {open > 99 ? "99+" : open}
      </span>
    ) : null;

  return (
    <div className="adm adm-shell">
      <aside className="adm-side" aria-label="Admin">
        <div className="adm-brand">
          <span className="adm-brand-mark" aria-hidden="true">
            <Icon name="shield" size={18} />
          </span>
          <span>Admin</span>
        </div>
        <nav aria-label="Sections">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="adm-nav">
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {badge(n.label)}
            </NavLink>
          ))}
        </nav>
        <div className="adm-side-foot">
          <span className="adm-who" title="Signed in as">
            {admin.name}
          </span>
          <button
            type="button"
            className="adm-btn secondary small"
            onClick={() => void admin.signOut()}
          >
            <Icon name="signout" size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="adm-main">
        <div ref={sentinel} className="adm-sentinel" aria-hidden="true" />
        <header className="adm-top" data-scrolled={scrolled || undefined}>
          <span className="adm-top-title">{here?.label}</span>
          <span className="adm-live" title="Updates every few seconds">
            <i aria-hidden="true" />
            Live
          </span>
        </header>
        <main id="adm-main" className="adm-content" tabIndex={-1}>
          <Routes>
            <Route index element={<Overview />} />
            <Route path="reports" element={<Reports />} />
            <Route path="bans" element={<Bans />} />
            <Route path="users" element={<Users />} />
            <Route path="activity" element={<Activity />} />
            <Route path="system" element={<System />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
      </div>

      <nav className="adm-tabs" aria-label="Sections">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="adm-tab">
            <span className="adm-tab-icon">
              <Icon name={n.icon} size={22} />
              {badge(n.label)}
            </span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
