import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import {
  AdminLoginRequest,
  BanRequest,
  LiftBanRequest,
  RestoreBanRequest,
  type AdminBanResult,
  type AdminLive,
  type AdminMe,
  type AdminReportStatus,
  type AdminSystem,
  type ErrorResponse,
} from "@passerby/shared";
import { Limiter } from "../auth/limiter.js";
import { cookieValue } from "../auth/session.js";
import type { Health } from "../db.js";
import type { EventSink } from "../events.js";
import { csvRow } from "./csv.js";
import { BadCursor, type AdminData, type EventFilter } from "./data.js";
import { ADMIN_COOKIE, ADMIN_MS, AdminSessions } from "./session.js";

/** Settings the System page shows. Never a secret. */
export interface SystemInfo {
  version: string;
  siteName: string;
  publicUrl: string;
  video: boolean;
  googleSignIn: boolean;
  turn: boolean;
  contact: boolean;
  environment: string;
  eventDays: number;
  reportDays: number;
}

export interface AdminRouterDeps {
  /** The owner's name and key. Null switches the admin area off. */
  credentials: { user: string; key: string } | null;
  /** Signs the admin cookie. */
  secret: string;
  publicUrl: string;
  visitorOf(address: string): string;
  data: AdminData;
  /** Who is on the site right now. */
  live(): AdminLive;
  /** Ban someone and remove them from the site right now. */
  ban(visitor: string, hours: number, reason: "age" | "rules" | "reports"): Promise<unknown>;
  events: EventSink;
  health: Health;
  info: SystemInfo;
  startedAt?: number;
  limiter?: Limiter;
  sessions?: AdminSessions;
  now?: () => number;
}

/** Wrong sign-ins allowed per address, and across everyone, in the window. */
export const LOGIN_MAX_PER_ADDRESS = 8;
export const LOGIN_MAX_TOTAL = 40;
export const LOGIN_WINDOW_MS = 15 * 60_000;
/** The most rows a CSV download holds. */
export const CSV_MAX_ROWS = 50_000;

const fail = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

const same = (a: string, b: string) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

const STATUSES = ["open", "banned", "dismissed", "all"] as const;
const KINDS = ["user", "admin", "system"] as const;
const first = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const limitOf = (v: unknown, fallback = 30) => {
  const n = Number.parseInt(first(v) ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : fallback;
};
/** The last 8 characters of a record's ID: enough to tell them apart in the log, not a secret. */
const short = (id: string) => id.slice(-8);

/** The admin area's API. Mounted at /api/v1/admin. */
export function createAdminRouter(deps: AdminRouterDeps): Router {
  const { data, credentials } = deps;
  const now = deps.now ?? Date.now;
  const router = Router();
  const limiter = deps.limiter ?? new Limiter(now);
  const sessions = deps.sessions ?? new AdminSessions(deps.secret, now);
  const publicHost = new URL(deps.publicUrl).host;
  const startedAt = deps.startedAt ?? now();

  router.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-robots-tag", "noindex, nofollow");
    next();
  });

  // Only this site's own pages may change anything.
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (req.method === "GET" || !origin) return next();
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // unreadable: refused below
    }
    if (host === req.headers.host || host === publicHost) return next();
    res.status(403).json(fail("bad_origin", "That request came from another website."));
  });

  const visitor = (req: Request) => deps.visitorOf(req.ip ?? "?");
  const cookie = (req: Request) => cookieValue(req.headers.cookie, ADMIN_COOKIE);
  const cookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: "strict" as const,
    secure: req.secure,
    path: "/api/v1/admin",
  });
  const log = (req: Request, type: string, detail = "", about?: string) =>
    deps.events.record({ kind: "admin", type, visitor: about ?? visitor(req), detail });

  function body<T>(
    schema: {
      safeParse(
        v: unknown,
      ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
    },
    req: Request,
    res: Response,
  ): T | null {
    const parsed = schema.safeParse(req.body);
    if (parsed.success) return parsed.data;
    res
      .status(400)
      .json(
        fail("invalid", parsed.error.issues[0]?.message ?? "That request couldn't be understood."),
      );
    return null;
  }

  /** Turns a bad page marker into a 400, and passes anything else on. */
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof BadCursor) res.status(400).json(fail("bad_cursor", err.message));
        else next(err);
      }
    };

  const admin: RequestHandler = (req, res, next) => {
    if (!credentials) {
      res.status(404).json(fail("admin_disabled", "The admin area isn't set up on this server."));
      return;
    }
    if (!sessions.valid(cookie(req))) {
      res.status(401).json(fail("not_signed_in", "Sign in first."));
      return;
    }
    next();
  };

  // ---- signing in and out ----

  router.get("/me", (req, res) => {
    const out: AdminMe = {
      enabled: credentials !== null,
      admin: credentials && sessions.valid(cookie(req)) ? credentials.user : null,
    };
    res.json(out);
  });

  router.post(
    "/login",
    route(async (req, res) => {
      if (!credentials) {
        return res
          .status(404)
          .json(fail("admin_disabled", "The admin area isn't set up on this server."));
      }
      const who = visitor(req);
      if (
        limiter.count(`admin:${who}`, LOGIN_WINDOW_MS) >= LOGIN_MAX_PER_ADDRESS ||
        limiter.count("admin:all", LOGIN_WINDOW_MS) >= LOGIN_MAX_TOTAL
      ) {
        return res
          .status(429)
          .json(fail("too_many", "Too many wrong attempts. Try again in a few minutes."));
      }
      const input = body(AdminLoginRequest, req, res);
      if (!input) return;
      // Both are always compared, so the time taken never says which one was wrong.
      const userOk = same(input.user, credentials.user);
      const keyOk = same(input.key, credentials.key);
      if (!(userOk && keyOk)) {
        limiter.strike(`admin:${who}`, LOGIN_WINDOW_MS);
        limiter.strike("admin:all", LOGIN_WINDOW_MS);
        log(req, "admin_login_failed");
        return res.status(401).json(fail("bad_credentials", "Wrong name or key."));
      }
      res.cookie(ADMIN_COOKIE, sessions.create(), { ...cookieOptions(req), maxAge: ADMIN_MS });
      log(req, "admin_login");
      const out: AdminMe = { enabled: true, admin: credentials.user };
      res.json(out);
    }),
  );

  router.post("/logout", (req, res) => {
    if (sessions.valid(cookie(req))) log(req, "admin_logout");
    sessions.revoke(cookie(req));
    res.clearCookie(ADMIN_COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });

  // ---- everything below needs a signed-in admin ----

  router.get(
    "/overview",
    admin,
    route(async (_req, res) => {
      res.json(await data.overview(deps.live()));
    }),
  );

  // reports

  router.get(
    "/reports",
    admin,
    route(async (req, res) => {
      const status = first(req.query.status) ?? "open";
      if (!(STATUSES as readonly string[]).includes(status)) {
        return res.status(400).json(fail("invalid", "Unknown report status."));
      }
      res.json(
        await data.listReports({
          status: status as AdminReportStatus | "all",
          cursor: first(req.query.cursor),
          limit: limitOf(req.query.limit),
        }),
      );
    }),
  );

  const reportOr404 = async (id: string, res: Response) => {
    const report = await data.reportDetail(id);
    if (!report) res.status(404).json(fail("not_found", "That report no longer exists."));
    return report;
  };

  router.get(
    "/reports/:id",
    admin,
    route(async (req, res) => {
      const report = await reportOr404(String(req.params.id), res);
      if (report) res.json({ report });
    }),
  );

  router.post(
    "/reports/:id/ban",
    admin,
    route(async (req, res) => {
      const id = String(req.params.id);
      const input = body(BanRequest, req, res);
      if (!input) return;
      const who = await data.reportedVisitor(id);
      if (!who) return res.status(404).json(fail("not_found", "That report no longer exists."));
      await deps.ban(who, input.hours, "rules"); // the ban is logged by the chat engine
      const settled = await data.settleOpenReports(who, "banned");
      await data.setReportStatus(id, "banned");
      const out: AdminBanResult = { report: (await data.reportDetail(id))!, settled };
      res.json(out);
    }),
  );

  const setStatus = (status: AdminReportStatus, type: string): RequestHandler =>
    route(async (req, res) => {
      const id = String(req.params.id);
      if (!(await data.setReportStatus(id, status))) {
        return res.status(404).json(fail("not_found", "That report no longer exists."));
      }
      log(req, type, `report ${short(id)}`);
      res.json({ report: await data.reportDetail(id) });
    });
  router.post("/reports/:id/dismiss", admin, setStatus("dismissed", "report_dismissed"));
  router.post("/reports/:id/reopen", admin, setStatus("open", "report_reopened"));

  // bans

  router.get(
    "/bans",
    admin,
    route(async (_req, res) => {
      res.json({ items: await data.listBans() });
    }),
  );

  router.post(
    "/bans/lift",
    admin,
    route(async (req, res) => {
      const input = body(LiftBanRequest, req, res);
      if (!input) return;
      const ban = await data.liftBan(input.visitor);
      if (!ban) return res.status(404).json(fail("not_found", "That ban has already ended."));
      log(req, "ban_lifted", "", ban.id);
      res.json({ ban });
    }),
  );

  // Undo for lifting a ban: puts it back with the same end time and reason.
  router.post(
    "/bans/restore",
    admin,
    route(async (req, res) => {
      const input = body(RestoreBanRequest, req, res);
      if (!input) return;
      const hours = Math.ceil((input.until - now()) / 3_600_000);
      if (hours < 1)
        return res.status(400).json(fail("invalid", "That ban would already be over."));
      await deps.ban(input.visitor, hours, input.reason);
      log(req, "ban_restored", "", input.visitor);
      res.json({ ok: true });
    }),
  );

  // users

  router.get(
    "/users",
    admin,
    route(async (req, res) => {
      const q = first(req.query.q)?.slice(0, 100);
      res.json(
        await data.listUsers({
          q,
          cursor: first(req.query.cursor),
          limit: limitOf(req.query.limit),
        }),
      );
    }),
  );

  const suspend = (suspended: boolean): RequestHandler =>
    route(async (req, res) => {
      const id = String(req.params.id);
      const user = await data.setSuspended(id, suspended);
      if (!user) return res.status(404).json(fail("not_found", "That account no longer exists."));
      log(req, suspended ? "user_suspended" : "user_unsuspended", `user ${short(id)}`);
      res.json({ user });
    });
  router.post("/users/:id/suspend", admin, suspend(true));
  router.post("/users/:id/unsuspend", admin, suspend(false));

  router.post(
    "/users/:id/reset-password",
    admin,
    route(async (req, res) => {
      const id = String(req.params.id);
      const done = await data.resetPassword(id);
      if (!done) return res.status(404).json(fail("not_found", "That account no longer exists."));
      log(req, "user_password_reset", `user ${short(id)}`); // the password itself is never logged
      res.json(done);
    }),
  );

  // the activity log

  const eventFilter = (req: Request): EventFilter => {
    const kind = first(req.query.kind);
    return {
      kind: (KINDS as readonly string[]).includes(kind ?? "")
        ? (kind as EventFilter["kind"])
        : undefined,
      q: first(req.query.q)?.slice(0, 100),
    };
  };

  router.get(
    "/events",
    admin,
    route(async (req, res) => {
      res.json(
        await data.listEvents({
          ...eventFilter(req),
          cursor: first(req.query.cursor),
          limit: limitOf(req.query.limit, 50),
        }),
      );
    }),
  );

  router.get(
    "/events.csv",
    admin,
    route(async (req, res) => {
      const days = Math.min(
        Math.max(Number.parseInt(first(req.query.days) ?? "30", 10) || 30, 1),
        3650,
      );
      const filter: EventFilter = {
        ...eventFilter(req),
        since: new Date(now() - days * 86_400_000),
      };
      log(req, "events_exported", `${days} days`);
      res.status(200);
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="activity-${new Date(now()).toISOString().slice(0, 10)}.csv"`,
      );
      res.write("﻿" + csvRow(["id", "time", "kind", "type", "visitor", "detail"]));
      for await (const page of data.eachEventPage(filter, CSV_MAX_ROWS)) {
        for (const e of page) res.write(csvRow([e.id, e.at, e.kind, e.type, e.visitor, e.detail]));
      }
      res.end();
    }),
  );

  // the system page

  router.get(
    "/system",
    admin,
    route(async (_req, res) => {
      const t0 = now();
      const up = await deps.health.ping();
      const ms = now() - t0;
      const [counts, problems] = up
        ? await Promise.all([data.counts(), data.problems()])
        : [{ users: 0, reports: 0, bans: 0, events: 0 }, []];
      const out: AdminSystem = {
        version: deps.info.version,
        node: process.version,
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        database: { up, ms },
        online: deps.live().online,
        settings: {
          siteName: deps.info.siteName,
          publicUrl: deps.info.publicUrl,
          video: deps.info.video,
          googleSignIn: deps.info.googleSignIn,
          turn: deps.info.turn,
          contact: deps.info.contact,
          environment: deps.info.environment,
        },
        retention: { eventDays: deps.info.eventDays, reportDays: deps.info.reportDays },
        counts,
        problems,
      };
      res.json(out);
    }),
  );

  return router;
}
