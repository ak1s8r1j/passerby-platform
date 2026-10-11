import { REPORT_REASON_LABELS } from "@passerby/shared";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "4 min ago", "3 hours ago", "yesterday", or a date for anything older. */
export function ago(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (!Number.isFinite(diff)) return "";
  if (diff < 45_000) return "just now";
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MIN))} min ago`;
  if (diff < DAY) return `${plural(Math.round(diff / HOUR), "hour")} ago`;
  if (diff < 2 * DAY) return "yesterday";
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)} days ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** How long until a time, for a ban that is still running: "in 3 h 12 min", "in 2 days". */
export function timeLeft(until: number, now = Date.now()): string {
  const diff = until - now;
  if (diff <= 0) return "ended";
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MIN))} min`;
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    const m = Math.round((diff % HOUR) / MIN);
    return m === 60 ? `in ${h + 1} h` : m ? `in ${h} h ${m} min` : `in ${h} h`;
  }
  return `in ${plural(Math.round(diff / DAY), "day")}`;
}

/** "Fri 14:30", for exact times that are still recent. */
export const clock = (value: string | number): string =>
  new Date(value).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** A full date and time, for titles and tooltips. */
export const fullDate = (value: string | number): string =>
  new Date(value).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const dateOnly = (iso: string): string =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export const hourLabel = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric" });

export const reasonTitle = (reason: string): string =>
  (REPORT_REASON_LABELS as Record<string, string>)[reason] ?? reason;

const EVENT_LABELS: Record<string, string> = {
  register: "Account created",
  login: "Signed in",
  login_failed: "Failed sign-in",
  login_blocked: "Sign-in blocked",
  password_changed: "Password changed",
  password_set: "Password set",
  account_deleted: "Account deleted",
  google_register: "Account created with Google",
  google_login: "Signed in with Google",
  google_linked: "Google connected",
  google_unlinked: "Google disconnected",
  google_refused: "Google sign-in refused",
  report: "Chat reported",
  ban: "Ban",
  ban_lifted: "Ban lifted",
  ban_restored: "Ban restored",
  report_dismissed: "Report dismissed",
  report_reopened: "Report reopened",
  user_suspended: "Account suspended",
  user_unsuspended: "Account restored",
  user_password_reset: "Password reset",
  admin_login: "Admin signed in",
  admin_login_failed: "Failed admin sign-in",
  admin_logout: "Admin signed out",
  events_exported: "Activity exported",
  startup: "Server started",
  retention: "Old data removed",
  error: "Error",
  warning: "Warning",
};

/** A plain name for an event type. Unknown types are tidied up rather than hidden. */
export function eventLabel(type: string): string {
  const known = EVENT_LABELS[type];
  if (known) return known;
  const text = type.replace(/_/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Event";
}

export const BAN_REASON_LABELS = {
  age: "Under 18",
  rules: "Broke the rules",
  reports: "Reported by several people",
} as const;

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** How long the server has been running: "42 s", "5 min", "2 h 5 min", "3 days 4 h". */
export function uptime(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} s`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24
    ? `${d} ${d === 1 ? "day" : "days"} ${h % 24} h`
    : `${d} ${d === 1 ? "day" : "days"}`;
}
