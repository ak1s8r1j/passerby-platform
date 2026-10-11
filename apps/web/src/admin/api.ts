import type {
  AdminBan,
  AdminBanResult,
  AdminEvent,
  AdminMe,
  AdminOverview,
  AdminReport,
  AdminReportDetail,
  AdminReportStatus,
  AdminSystem,
  AdminUser,
  Page,
} from "@passerby/shared";

/** A failed admin request, with the server's plain-language message. */
export class AdminApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let onSignedOut: (() => void) | null = null;
/** The frame registers this so any request that finds the sign-in gone sends the owner back to the login. */
export const whenSignedOut = (fn: (() => void) | null) => {
  onSignedOut = fn;
};

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/admin${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      ...(init.body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }
        : init.method === "POST"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
    });
  } catch {
    throw new AdminApiError(
      0,
      "network",
      "Can't reach the server. Check your connection and try again.",
    );
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const code = error?.code ?? "unknown";
    if (res.status === 401 && code === "not_signed_in") onSignedOut?.();
    throw new AdminApiError(res.status, code, error?.message ?? "Something went wrong. Try again.");
  }
  return body as T;
}

const query = (params: Record<string, string | number | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const text = q.toString();
  return text ? `?${text}` : "";
};

export type EventKind = "user" | "admin" | "system";

export const adminApi = {
  me: () => call<AdminMe>("/me"),
  login: (user: string, key: string) =>
    call<AdminMe>("/login", { method: "POST", body: { user, key } }),
  logout: () => call<{ ok: true }>("/logout", { method: "POST" }),
  overview: () => call<AdminOverview>("/overview"),

  reports: (status: AdminReportStatus | "all", cursor?: string) =>
    call<Page<AdminReport>>(`/reports${query({ status, cursor })}`),
  report: (id: string) =>
    call<{ report: AdminReportDetail }>(`/reports/${encodeURIComponent(id)}`).then((r) => r.report),
  banFromReport: (id: string, hours: number) =>
    call<AdminBanResult>(`/reports/${encodeURIComponent(id)}/ban`, {
      method: "POST",
      body: { hours },
    }),
  dismiss: (id: string) =>
    call<{ report: AdminReportDetail }>(`/reports/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
    }).then((r) => r.report),
  reopen: (id: string) =>
    call<{ report: AdminReportDetail }>(`/reports/${encodeURIComponent(id)}/reopen`, {
      method: "POST",
    }).then((r) => r.report),

  bans: () => call<{ items: AdminBan[] }>("/bans").then((r) => r.items),
  liftBan: (visitor: string) =>
    call<{ ban: AdminBan }>("/bans/lift", { method: "POST", body: { visitor } }).then((r) => r.ban),
  restoreBan: (ban: AdminBan) =>
    call<{ ok: true }>("/bans/restore", {
      method: "POST",
      body: { visitor: ban.id, until: ban.until, reason: ban.reason },
    }),

  users: (q: string, cursor?: string) => call<Page<AdminUser>>(`/users${query({ q, cursor })}`),
  suspend: (id: string) =>
    call<{ user: AdminUser }>(`/users/${encodeURIComponent(id)}/suspend`, { method: "POST" }).then(
      (r) => r.user,
    ),
  unsuspend: (id: string) =>
    call<{ user: AdminUser }>(`/users/${encodeURIComponent(id)}/unsuspend`, {
      method: "POST",
    }).then((r) => r.user),
  resetPassword: (id: string) =>
    call<{ user: AdminUser; password: string }>(`/users/${encodeURIComponent(id)}/reset-password`, {
      method: "POST",
    }),

  events: (filter: { kind?: EventKind; q?: string }, cursor?: string) =>
    call<Page<AdminEvent>>(`/events${query({ ...filter, cursor })}`),
  /** The address of the CSV download for the same filter. A plain link, so the browser saves the file. */
  eventsCsvUrl: (filter: { kind?: EventKind; q?: string }, days = 30) =>
    `/api/v1/admin/events.csv${query({ ...filter, days })}`,

  system: () => call<AdminSystem>("/system"),
};
