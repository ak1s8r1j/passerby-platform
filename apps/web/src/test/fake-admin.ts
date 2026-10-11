import { vi } from "vitest";
import type {
  AdminBan,
  AdminEvent,
  AdminLive,
  AdminReport,
  AdminReportDetail,
  AdminReportStatus,
  AdminSystem,
  AdminUser,
  TranscriptLine,
} from "@passerby/shared";

interface StoredReport extends AdminReportDetail {
  /** The full ID of the person reported, which the page never sees. */
  full: string;
}

/** What `report()` takes to make a saved report for the stand-in server. */
export const report = (i: number, over: Partial<StoredReport> = {}): StoredReport => ({
  id: `r${i}`,
  createdAt: new Date(Date.now() - i * 60_000).toISOString(),
  mode: "text",
  reason: "harassment",
  reporter: `rep${i}`.padEnd(8, "0"),
  reported: `bad${i}`.padEnd(8, "0"),
  status: "open",
  messages: 2,
  transcript: [
    { who: "reporter", x: "hello" },
    { who: "reported", x: "something rude" },
  ],
  reportersToday: 1,
  reportsTotal: 1,
  ban: null,
  full: `full-visitor-${i}`.padEnd(24, "x"),
  ...over,
});

export const user = (i: number, over: Partial<AdminUser> = {}): AdminUser => ({
  id: `u${i}`,
  name: `Person ${i}`,
  email: `person${i}@example.com`,
  createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
  lastLoginAt: new Date(Date.now() - i * 3_600_000).toISOString(),
  loginCount: i + 1,
  google: false,
  hasPassword: true,
  suspended: false,
  premiumUntil: null,
  ...over,
});

export const event = (i: number, over: Partial<AdminEvent> = {}): AdminEvent => ({
  id: String(1000 - i),
  at: new Date(Date.now() - i * 60_000).toISOString(),
  kind: "user",
  type: "login",
  visitor: `vis${i}`.padEnd(8, "0"),
  detail: "",
  ...over,
});

const ban = (i: number, over: Partial<AdminBan> = {}): AdminBan => ({
  id: `banned-visitor-${i}`.padEnd(24, "x"),
  tag: `ban${i}`.padEnd(8, "0"),
  reason: "rules",
  until: Date.now() + 5 * 3_600_000,
  createdAt: new Date().toISOString(),
  ...over,
});
export { ban };

/** A stand-in for the admin part of the server. It follows the same rules, so the pages can be tried end to end. */
export class FakeAdmin {
  enabled = true;
  signedIn = false;
  reports: StoredReport[] = [];
  bans: AdminBan[] = [];
  users: AdminUser[] = [];
  events: AdminEvent[] = [];
  live: AdminLive = { online: 12, text: 8, video: 4, searching: 2, chatting: 6 };
  pageSize = 30;
  calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  failNext: { status: number; code: string; message: string } | null = null;
  down = false;
  /** If set, `failNext` waits for a request to this path (otherwise it hits the very next request). */
  failOn: string | null = null;
  /** The next overview answer is a 401, as if the sign-in had run out. */
  expireNext = false;
  tempPassword = "Xk3-p9Lm2Qzr";
  problems: AdminEvent[] = [];

  static signedIn() {
    const a = new FakeAdmin();
    a.signedIn = true;
    return a;
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status });
  }
  private error(status: number, code: string, message: string) {
    return this.json({ error: { code, message } }, status);
  }

  private summary(r: StoredReport): AdminReport {
    return {
      id: r.id,
      createdAt: r.createdAt,
      mode: r.mode,
      reason: r.reason,
      reporter: r.reporter,
      reported: r.reported,
      status: r.status,
      messages: r.transcript.length,
    };
  }
  private detail(r: StoredReport): AdminReportDetail {
    const { full, ...rest } = r;
    const active = this.bans.find((b) => b.id === full && b.until > Date.now());
    return { ...rest, ban: active ?? null };
  }
  private page<T>(items: T[], cursor: string | null) {
    const start = cursor ? Number(cursor) : 0;
    const slice = items.slice(start, start + this.pageSize);
    return {
      items: slice,
      next: start + this.pageSize < items.length ? String(start + this.pageSize) : null,
    };
  }

  async handle(url: string, init?: RequestInit): Promise<Response> {
    if (this.down) throw new TypeError("Failed to fetch");
    const [rawPath, rawQuery = ""] = url.replace("/api/v1/admin", "").split("?");
    const path = rawPath!;
    const q = new URLSearchParams(rawQuery);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (method !== "GET") this.calls.push({ method, path, body });
    else this.calls.push({ method, path: path + (rawQuery ? `?${rawQuery}` : ""), body });

    if (this.failNext && (!this.failOn || path === this.failOn)) {
      const f = this.failNext;
      this.failNext = null;
      return this.error(f.status, f.code, f.message);
    }
    if (path === "/me") {
      return this.json({
        enabled: this.enabled,
        admin: this.enabled && this.signedIn ? "owner" : null,
      });
    }
    if (path === "/login") {
      if (body.user !== "owner" || body.key !== "right-key-12345") {
        return this.error(401, "bad_credentials", "Wrong name or key.");
      }
      this.signedIn = true;
      return this.json({ enabled: true, admin: "owner" });
    }
    if (path === "/logout") {
      this.signedIn = false;
      return this.json({ ok: true });
    }
    if (!this.signedIn || this.expireNext) {
      this.expireNext = false;
      this.signedIn = false;
      return this.error(401, "not_signed_in", "Sign in first.");
    }

    if (path === "/overview") {
      const open = this.reports.filter((r) => r.status === "open");
      return this.json({
        live: this.live,
        day: {
          visitors: 120,
          chats: 45,
          messages: 900,
          reports: open.length,
          newUsers: 3,
          bans: this.bans.length,
        },
        totals: {
          users: this.users.length,
          openReports: open.length,
          activeBans: this.bans.length,
        },
        hours: Array.from({ length: 24 }, (_v, i) => ({
          hour: new Date(Date.UTC(2026, 9, 9, i)).toISOString(),
          visitors: i,
          chats: i % 5,
          videoChats: 0,
          messages: i * 3,
          peakOnline: i,
        })),
        recentReports: open.slice(0, 5).map((r) => this.summary(r)),
      });
    }
    if (path === "/reports") {
      const status = q.get("status") ?? "open";
      const list = this.reports.filter((r) => status === "all" || r.status === status);
      return this.json(
        this.page(
          list.map((r) => this.summary(r)),
          q.get("cursor"),
        ),
      );
    }
    const one = /^\/reports\/([^/]+)(?:\/(ban|dismiss|reopen))?$/.exec(path);
    if (one) {
      const r = this.reports.find((x) => x.id === decodeURIComponent(one[1]!));
      if (!r) return this.error(404, "not_found", "That report no longer exists.");
      const action = one[2];
      if (!action) return this.json({ report: this.detail(r) });
      if (action === "ban") {
        const hours = Number(body.hours);
        if (!Number.isInteger(hours) || hours < 1)
          return this.error(400, "invalid", "Choose a ban length.");
        this.bans = [
          ...this.bans.filter((b) => b.id !== r.full),
          {
            id: r.full,
            tag: r.reported,
            reason: "rules",
            until: Date.now() + hours * 3_600_000,
            createdAt: new Date().toISOString(),
          },
        ];
        // like the real server: banning closes every open report about the same person, and says which
        const settled = this.reports
          .filter((x) => x.full === r.full && x.status === "open")
          .map((x) => x.id);
        for (const x of this.reports) if (settled.includes(x.id)) x.status = "banned";
        r.status = "banned";
        return this.json({ report: this.detail(r), settled });
      } else if (action === "dismiss") r.status = "dismissed";
      else r.status = "open";
      return this.json({ report: this.detail(r) });
    }
    if (path === "/bans")
      return this.json({ items: this.bans.filter((b) => b.until > Date.now()) });
    if (path === "/bans/lift") {
      const b = this.bans.find((x) => x.id === body.visitor);
      if (!b) return this.error(404, "not_found", "That ban has already ended.");
      this.bans = this.bans.filter((x) => x !== b);
      return this.json({ ban: b });
    }
    if (path === "/bans/restore") {
      // like the real server: one ban per person, so this replaces any that is there
      this.bans = [
        ...this.bans.filter((b) => b.id !== body.visitor),
        ban(99, {
          id: String(body.visitor),
          until: Number(body.until),
          reason: body.reason as AdminBan["reason"],
        }),
      ];
      return this.json({ ok: true });
    }
    if (path === "/users") {
      const term = (q.get("q") ?? "").toLowerCase();
      const list = this.users.filter(
        (u) => !term || u.email.toLowerCase().includes(term) || u.name.toLowerCase().includes(term),
      );
      return this.json(this.page(list, q.get("cursor")));
    }
    const act = /^\/users\/([^/]+)\/(suspend|unsuspend|reset-password)$/.exec(path);
    if (act) {
      const u = this.users.find((x) => x.id === act[1]);
      if (!u) return this.error(404, "not_found", "That account no longer exists.");
      if (act[2] === "suspend") u.suspended = true;
      if (act[2] === "unsuspend") u.suspended = false;
      if (act[2] === "reset-password") {
        u.hasPassword = true;
        return this.json({ user: { ...u }, password: this.tempPassword });
      }
      return this.json({ user: { ...u } });
    }
    if (path === "/events") {
      const kind = q.get("kind");
      const term = (q.get("q") ?? "").toLowerCase();
      const list = this.events.filter(
        (e) =>
          (!kind || e.kind === kind) &&
          (!term ||
            e.type.includes(term) ||
            e.detail.toLowerCase().includes(term) ||
            e.visitor.startsWith(term)),
      );
      return this.json(this.page(list, q.get("cursor")));
    }
    if (path === "/system") {
      const s: AdminSystem = {
        version: "0.1.0",
        node: "v22.0.0",
        uptimeSeconds: 3 * 3600 + 120,
        memoryMb: 128,
        database: { up: true, ms: 4 },
        online: this.live.online,
        settings: {
          siteName: "Passerby",
          publicUrl: "http://localhost:5173",
          video: true,
          googleSignIn: true,
          turn: false,
          contact: true,
          environment: "development",
        },
        retention: { eventDays: 30, reportDays: 90 },
        counts: {
          users: this.users.length,
          reports: this.reports.length,
          bans: this.bans.length,
          events: this.events.length,
        },
        problems: this.problems,
      };
      return this.json(s);
    }
    return this.error(404, "not_found", "There is no such API route.");
  }
}

export type { TranscriptLine, AdminReportStatus };

/** Make `fetch` answer admin calls from the stand-in, and say nobody is signed in to the public site. */
export function stubAdmin(admin: FakeAdmin) {
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.startsWith("/api/v1/admin")) return admin.handle(path, init);
    if (path.includes("/api/v1/auth/me")) return new Response(JSON.stringify({ user: null }));
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

/** Ask for reduced motion, so sheets fade and numbers jump, which keeps tests fast and exact. */
export function reduceMotion(reduce = true) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}
