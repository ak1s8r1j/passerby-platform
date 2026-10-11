import { randomBytes } from "node:crypto";
import type {
  AdminBan,
  AdminEvent,
  AdminLive,
  AdminOverview,
  AdminReport,
  AdminReportDetail,
  AdminReportStatus,
  AdminUser,
  Page,
  TranscriptLine,
} from "@passerby/shared";
import type { Hasher } from "../auth/passwords.js";
import type { Db } from "../db.js";
import { fillHours, startOfHour } from "./hours.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A pagination cursor that was not made by us. */
export class BadCursor extends Error {
  constructor() {
    super("That page marker isn't valid.");
  }
}

/** The short label for a scrambled visitor ID: the same 8 characters the activity log shows. */
export const tag = (visitor: string) => visitor.slice(0, 8);

const encode = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
function decode(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, "base64url").toString().split("|");
  const at = new Date(iso ?? "");
  if (!iso || !id || Number.isNaN(at.getTime())) throw new BadCursor();
  return { at, id };
}

/** Only well-formed lines come out of a saved transcript, whatever is in the column. */
function lines(value: unknown): TranscriptLine[] {
  if (!Array.isArray(value)) return [];
  const out: TranscriptLine[] = [];
  for (const v of value) {
    const item = v as { who?: unknown; x?: unknown } | null;
    if ((item?.who === "reporter" || item?.who === "reported") && typeof item.x === "string") {
      out.push({ who: item.who, x: item.x });
    }
  }
  return out;
}

interface ReportRow {
  id: string;
  createdAt: Date;
  mode: string;
  reason: string;
  reporter: string;
  reported: string;
  status: AdminReportStatus;
  transcript: unknown;
}

const toReport = (r: ReportRow): AdminReport => ({
  id: r.id,
  createdAt: r.createdAt.toISOString(),
  mode: r.mode,
  reason: r.reason,
  reporter: r.reporter === "system" ? "system" : tag(r.reporter),
  reported: tag(r.reported),
  status: r.status,
  messages: lines(r.transcript).length,
});

const toBan = (b: { visitor: string; until: Date; reason: string; createdAt: Date }): AdminBan => ({
  id: b.visitor,
  tag: tag(b.visitor),
  reason: b.reason === "age" || b.reason === "reports" ? b.reason : "rules",
  until: b.until.getTime(),
  createdAt: b.createdAt.toISOString(),
});

const toUser = (u: {
  id: string;
  displayName: string;
  email: string;
  createdAt: Date;
  lastLoginAt: Date | null;
  loginCount: number;
  googleSub: string | null;
  passwordHash: string | null;
  disabledAt: Date | null;
  premiumUntil: Date | null;
}): AdminUser => ({
  id: u.id,
  name: u.displayName,
  email: u.email,
  createdAt: u.createdAt.toISOString(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  loginCount: u.loginCount,
  google: u.googleSub !== null,
  hasPassword: u.passwordHash !== null,
  suspended: u.disabledAt !== null,
  premiumUntil: u.premiumUntil?.toISOString() ?? null,
});

const toEvent = (e: {
  id: bigint;
  at: Date;
  kind: "user" | "admin" | "system";
  type: string;
  visitor: string;
  detail: string;
}): AdminEvent => ({
  id: String(e.id), // JSON cannot hold the database's big integer
  at: e.at.toISOString(),
  kind: e.kind,
  type: e.type,
  visitor: e.visitor,
  detail: e.detail,
});

export interface EventFilter {
  kind?: "user" | "admin" | "system";
  /** Matches the event's type or detail, or the start of the visitor tag. */
  q?: string;
  /** Only events newer than this. */
  since?: Date;
}

/** Everything the admin area reads and changes in the database. */
export class AdminData {
  constructor(
    private db: Db,
    private hasher: Hasher,
    private now: () => number = Date.now,
  ) {}

  // ---- overview ----

  async overview(live: AdminLive): Promise<AdminOverview> {
    const now = this.now();
    const since = new Date(startOfHour(now) - 23 * HOUR);
    const [rows, users, newUsers, openReports, activeBans, recent] = await Promise.all([
      this.db.hourlyStat.findMany({ where: { hour: { gte: since } }, orderBy: { hour: "asc" } }),
      this.db.user.count(),
      this.db.user.count({ where: { createdAt: { gte: new Date(now - DAY) } } }),
      this.db.report.count({ where: { status: "open" } }),
      this.db.ban.count({ where: { until: { gt: new Date(now) } } }),
      this.db.report.findMany({
        where: { status: "open" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
      }),
    ]);
    const sum = (key: "visitors" | "chats" | "messages" | "reports" | "bans") =>
      rows.reduce((total, r) => total + r[key], 0);
    return {
      live,
      day: {
        visitors: sum("visitors"),
        chats: sum("chats"),
        messages: sum("messages"),
        reports: sum("reports"),
        newUsers,
        bans: sum("bans"),
      },
      totals: { users, openReports, activeBans },
      hours: fillHours(rows, now),
      recentReports: recent.map(toReport),
    };
  }

  // ---- reports ----

  async listReports(opts: {
    status: AdminReportStatus | "all";
    cursor?: string;
    limit: number;
  }): Promise<Page<AdminReport>> {
    const c = decode(opts.cursor);
    const rows = await this.db.report.findMany({
      where: {
        ...(opts.status === "all" ? {} : { status: opts.status }),
        ...(c ? { OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      items: page.map(toReport),
      next: rows.length > opts.limit && last ? encode(last.createdAt, last.id) : null,
    };
  }

  async reportDetail(id: string): Promise<AdminReportDetail | null> {
    const r = await this.db.report.findUnique({ where: { id } });
    if (!r) return null;
    const now = this.now();
    const [reporters, total, ban] = await Promise.all([
      this.db.report.findMany({
        where: {
          reported: r.reported,
          createdAt: { gte: new Date(now - DAY) },
          reporter: { notIn: ["system", r.reported] },
        },
        distinct: ["reporter"],
        select: { reporter: true },
      }),
      this.db.report.count({ where: { reported: r.reported } }),
      this.db.ban.findUnique({ where: { visitor: r.reported } }),
    ]);
    return {
      ...toReport(r),
      transcript: lines(r.transcript),
      reportersToday: reporters.length,
      reportsTotal: total,
      ban: ban && ban.until.getTime() > now ? toBan(ban) : null,
    };
  }

  /** The full ID of the person a report is about, which never leaves the server. */
  async reportedVisitor(id: string): Promise<string | null> {
    const r = await this.db.report.findUnique({ where: { id }, select: { reported: true } });
    return r?.reported ?? null;
  }

  async setReportStatus(id: string, status: AdminReportStatus): Promise<boolean> {
    const { count } = await this.db.report.updateMany({ where: { id }, data: { status } });
    return count > 0;
  }

  /** After banning someone, close every open report about them. Returns the IDs it closed. */
  async settleOpenReports(visitor: string, status: AdminReportStatus): Promise<string[]> {
    const open = await this.db.report.findMany({
      where: { reported: visitor, status: "open" },
      select: { id: true },
    });
    const ids = open.map((r) => r.id);
    if (ids.length)
      await this.db.report.updateMany({ where: { id: { in: ids } }, data: { status } });
    return ids;
  }

  // ---- bans ----

  async listBans(): Promise<AdminBan[]> {
    const rows = await this.db.ban.findMany({
      where: { until: { gt: new Date(this.now()) } },
      orderBy: { until: "desc" },
      take: 500,
    });
    return rows.map(toBan);
  }

  /** Remove a ban. Returns what it was, so it can be put back, or null if there was none. */
  async liftBan(visitor: string): Promise<AdminBan | null> {
    const row = await this.db.ban.findUnique({ where: { visitor } });
    if (!row) return null;
    await this.db.ban.deleteMany({ where: { visitor } });
    return toBan(row);
  }

  // ---- users ----

  async listUsers(opts: { q?: string; cursor?: string; limit: number }): Promise<Page<AdminUser>> {
    const c = decode(opts.cursor);
    const q = opts.q?.trim();
    const rows = await this.db.user.findMany({
      where: {
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" } },
                { displayName: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
        ...(c
          ? { AND: [{ OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] }] }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    const last = page.at(-1);
    return {
      items: page.map(toUser),
      next: rows.length > opts.limit && last ? encode(last.createdAt, last.id) : null,
    };
  }

  /**
   * Suspend or restore an account. Suspending also raises the session version, which signs the person out
   * everywhere at once.
   */
  async setSuspended(id: string, suspended: boolean): Promise<AdminUser | null> {
    const exists = await this.db.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const user = await this.db.user.update({
      where: { id },
      data: suspended
        ? { disabledAt: new Date(this.now()), sessionVersion: { increment: 1 } }
        : { disabledAt: null },
    });
    return toUser(user);
  }

  /**
   * Give someone a new random password, for when they are locked out (there is no "forgot password" email
   * yet). It is shown to the admin once and never stored in readable form. All their sign-ins end.
   */
  async resetPassword(id: string): Promise<{ user: AdminUser; password: string } | null> {
    const exists = await this.db.user.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return null;
    const password = randomBytes(9).toString("base64url"); // 12 characters, 72 random bits
    const user = await this.db.user.update({
      where: { id },
      data: { passwordHash: await this.hasher.hash(password), sessionVersion: { increment: 1 } },
    });
    return { user: toUser(user), password };
  }

  // ---- the activity log ----

  private eventWhere(f: EventFilter) {
    const q = f.q?.trim();
    return {
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.since ? { at: { gte: f.since } } : {}),
      ...(q
        ? {
            OR: [
              { type: { contains: q, mode: "insensitive" as const } },
              { detail: { contains: q, mode: "insensitive" as const } },
              { visitor: { startsWith: q.toLowerCase() } },
            ],
          }
        : {}),
    };
  }

  async listEvents(
    opts: EventFilter & { cursor?: string; limit: number },
  ): Promise<Page<AdminEvent>> {
    if (opts.cursor && !/^\d{1,18}$/.test(opts.cursor)) throw new BadCursor();
    const rows = await this.db.event.findMany({
      where: {
        ...this.eventWhere(opts),
        ...(opts.cursor ? { id: { lt: BigInt(opts.cursor) } } : {}),
      },
      orderBy: { id: "desc" },
      take: opts.limit + 1,
    });
    const page = rows.slice(0, opts.limit);
    return {
      items: page.map(toEvent),
      next: rows.length > opts.limit && page.length ? String(page.at(-1)!.id) : null,
    };
  }

  /** Walks the whole log (newest first) one page at a time, for the CSV download, up to `max` rows. */
  async *eachEventPage(
    filter: EventFilter,
    max: number,
    pageSize = 1000,
  ): AsyncGenerator<AdminEvent[]> {
    let cursor: string | undefined;
    let seen = 0;
    while (seen < max) {
      const page = await this.listEvents({
        ...filter,
        cursor,
        limit: Math.min(pageSize, max - seen),
      });
      if (!page.items.length) return;
      seen += page.items.length;
      yield page.items;
      if (!page.next) return;
      cursor = page.next;
    }
  }

  // ---- the system page ----

  async counts() {
    const [users, reports, bans, events] = await Promise.all([
      this.db.user.count(),
      this.db.report.count(),
      this.db.ban.count({ where: { until: { gt: new Date(this.now()) } } }),
      this.db.event.count(),
    ]);
    return { users, reports, bans, events };
  }

  /** The latest warnings and errors the server recorded about itself. */
  async problems(limit = 15): Promise<AdminEvent[]> {
    const rows = await this.db.event.findMany({
      where: { kind: "system", type: { in: ["error", "warning"] } },
      orderBy: { id: "desc" },
      take: limit,
    });
    return rows.map(toEvent);
  }
}
