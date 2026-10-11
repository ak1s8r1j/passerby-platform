import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminData, BadCursor } from "../src/admin/data.js";
import { runRetention } from "../src/admin/retention.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { createApp } from "../src/app.js";
import { Limiter } from "../src/auth/limiter.js";
import { argon2 } from "../src/auth/passwords.js";
import { Accounts } from "../src/auth/service.js";
import { prismaUsers } from "../src/auth/store.js";
import { ChatEngine } from "../src/chat/engine.js";
import { prismaBans, prismaReports } from "../src/chat/stores.js";
import { createDb, type Db } from "../src/db.js";
import { prismaEvents } from "../src/events.js";
import { HourlyStats } from "../src/stats.js";
import { silent, testConfig } from "./helpers.js";

const CREDS = { user: "owner", key: "a-long-secret-key-123" };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let db: Db;
beforeAll(() => {
  db = createDb(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await db.$disconnect();
});

/** Wait for fire-and-forget writes (the activity log) to land. */
async function until<T>(fn: () => Promise<T | false | null | undefined>, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 30));
  }
}

let counter = 0;
const unique = () => `${Date.now()}${++counter}`;
/** A scrambled visitor ID the way the server makes them: 24 hex characters. */
const visitorId = () => unique().padStart(24, "a").slice(-24);

function build() {
  const events = prismaEvents(db, silent);
  const kicked: string[] = [];
  const engine = new ChatEngine({
    transport: {
      send: () => undefined,
      close: (id) => kicked.push(id),
    },
    bans: prismaBans(db),
    reports: prismaReports(db),
    events,
  });
  const data = new AdminData(db, argon2);
  const router = createAdminRouter({
    credentials: CREDS,
    secret: "admin-int-secret-123456",
    publicUrl: "http://localhost:5173",
    visitorOf: (ip) => `visitor:${ip}`,
    data,
    live: () => engine.snapshot(),
    ban: (v, h, r) => engine.ban(v, h, r, "admin"),
    events,
    health: { ping: async () => true },
    limiter: new Limiter(),
    info: {
      version: "9.9.9",
      siteName: "Test Site",
      publicUrl: "http://localhost:5173",
      video: true,
      googleSignIn: true,
      turn: false,
      contact: true,
      environment: "test",
      eventDays: 30,
      reportDays: 90,
    },
  });
  const app = createApp({
    config: testConfig(),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
    admin: router,
  });
  return { app, data, engine, kicked };
}

async function signedIn() {
  const w = build();
  const res = await request(w.app).post("/api/v1/admin/login").send(CREDS);
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
  // Signing in is itself logged (in the background). Let that land, then start each test with a clean log.
  await until(() => db.event.findFirst({ where: { type: "admin_login" } }));
  await db.event.deleteMany();
  const get = (path: string) => request(w.app).get(`/api/v1/admin${path}`).set("Cookie", cookie);
  const post = (path: string, body: object = {}) =>
    request(w.app).post(`/api/v1/admin${path}`).set("Cookie", cookie).send(body);
  return { ...w, get, post, cookie };
}

async function addReport(
  over: Partial<{
    reporter: string;
    reported: string;
    reason: string;
    status: "open" | "banned" | "dismissed";
    createdAt: Date;
    transcript: unknown;
    mode: string;
  }> = {},
) {
  return db.report.create({
    data: {
      mode: "text",
      reason: "harassment",
      reporter: visitorId(),
      reported: visitorId(),
      transcript: [
        { who: "reporter", x: "hi" },
        { who: "reported", x: "rude words" },
      ],
      ...over,
      // Prisma wants JSON, so a stray `unknown` is cast here once.
    } as never,
  });
}

beforeEach(async () => {
  await db.report.deleteMany();
  await db.ban.deleteMany();
  await db.event.deleteMany();
  await db.hourlyStat.deleteMany();
});

describe("saving the dashboard's counters", () => {
  it("adds to an hour that already has numbers, and keeps the highest peak", async () => {
    let t = Date.UTC(2026, 9, 9, 14, 5);
    const stats = new HourlyStats(() => t);
    stats.add("chats", 2);
    stats.online(5);
    await stats.flush(db);
    stats.add("chats", 3);
    stats.online(3); // lower than before
    await stats.flush(db);
    const [row] = await db.hourlyStat.findMany();
    expect(row).toMatchObject({ chats: 5, peakOnline: 5 });
    stats.online(9);
    await stats.flush(db);
    expect((await db.hourlyStat.findMany())[0]!.peakOnline).toBe(9);
    t += HOUR; // the next hour is its own row
    stats.add("messages", 4);
    await stats.flush(db);
    expect(await db.hourlyStat.count()).toBe(2);
  });
});

describe("the overview", () => {
  it("totals the last 24 hours, counts what needs attention, and fills quiet hours", async () => {
    const a = await signedIn();
    const now = Date.now();
    const thisHour = new Date(Math.floor(now / HOUR) * HOUR);
    await db.hourlyStat.create({
      data: {
        hour: thisHour,
        visitors: 10,
        chats: 4,
        messages: 40,
        reports: 2,
        bans: 1,
        peakOnline: 6,
      },
    });
    await db.hourlyStat.create({
      data: { hour: new Date(thisHour.getTime() - 5 * HOUR), visitors: 5, chats: 3, messages: 20 },
    });
    await db.hourlyStat.create({
      // more than a day old: not in "last 24 hours"
      data: { hour: new Date(thisHour.getTime() - 30 * HOUR), visitors: 999, chats: 999 },
    });
    await addReport();
    await addReport({ status: "dismissed" });
    await db.ban.create({
      data: { visitor: visitorId(), until: new Date(now + HOUR), reason: "rules" },
    });
    await db.ban.create({
      data: { visitor: visitorId(), until: new Date(now - HOUR), reason: "rules" },
    });

    const res = await a.get("/overview");
    expect(res.status).toBe(200);
    expect(res.body.day).toMatchObject({
      visitors: 15,
      chats: 7,
      messages: 60,
      reports: 2,
      bans: 1,
    });
    expect(res.body.totals.openReports).toBe(1);
    expect(res.body.totals.activeBans).toBe(1);
    expect(res.body.hours).toHaveLength(24);
    expect(res.body.hours.at(-1)).toMatchObject({ visitors: 10, peakOnline: 6 });
    expect(res.body.hours[18]).toMatchObject({ visitors: 5 });
    expect(res.body.hours.reduce((n: number, h: { visitors: number }) => n + h.visitors, 0)).toBe(
      15,
    );
    expect(res.body.live).toEqual({ online: 0, text: 0, video: 0, searching: 0, chatting: 0 });
    expect(res.body.recentReports).toHaveLength(1);
  });

  it("counts people who signed up in the last day", async () => {
    const a = await signedIn();
    const before = (await a.get("/overview")).body.day.newUsers;
    const accounts = new Accounts({
      store: prismaUsers(db),
      hasher: argon2,
      events: prismaEvents(db, silent),
      limiter: new Limiter(),
    });
    await accounts.register(
      {
        email: `new${unique()}@admin.test`,
        name: "Newcomer",
        password: "correct horse",
        gender: "m",
        adult: true,
      },
      "gv-new",
    );
    expect((await a.get("/overview")).body.day.newUsers).toBe(before + 1);
  });
});

describe("reports", () => {
  it("lists newest first, filtered by status, with short IDs and no full ones", async () => {
    const a = await signedIn();
    const reported = visitorId();
    const reporter = visitorId();
    const old = await addReport({ createdAt: new Date(Date.now() - 2 * HOUR) });
    const fresh = await addReport({ reported, reporter, reason: "nudity" });
    await addReport({ status: "banned" });
    await addReport({ status: "dismissed" });

    const open = await a.get("/reports");
    expect(open.status).toBe(200);
    expect(open.body.items.map((r: { id: string }) => r.id)).toEqual([fresh.id, old.id]);
    expect(open.body.items[0]).toMatchObject({
      reason: "nudity",
      status: "open",
      reported: reported.slice(0, 8),
      reporter: reporter.slice(0, 8),
      messages: 2,
      mode: "text",
    });
    expect(JSON.stringify(open.body)).not.toContain(reported);
    expect(JSON.stringify(open.body)).not.toContain(reporter);

    expect((await a.get("/reports?status=banned")).body.items).toHaveLength(1);
    expect((await a.get("/reports?status=dismissed")).body.items).toHaveLength(1);
    expect((await a.get("/reports?status=all")).body.items).toHaveLength(4);
    expect((await a.get("/reports?status=whatever")).status).toBe(400);
  });

  it("shows an automatic report as 'system'", async () => {
    const a = await signedIn();
    await addReport({ reporter: "system", reason: "underage" });
    expect((await a.get("/reports")).body.items[0].reporter).toBe("system");
  });

  it("pages through everything exactly once, even when reports share a timestamp", async () => {
    const a = await signedIn();
    const same = new Date(Date.now() - HOUR);
    const made = [];
    for (let i = 0; i < 7; i++) made.push((await addReport({ createdAt: same })).id);
    made.push((await addReport({ createdAt: new Date(Date.now() - 3 * HOUR) })).id);

    const seen: string[] = [];
    let cursor = "";
    for (let page = 0; page < 10; page++) {
      const res = await a.get(`/reports?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((r: { id: string }) => r.id));
      if (!res.body.next) break;
      cursor = res.body.next;
    }
    expect(seen).toHaveLength(8);
    expect(new Set(seen)).toEqual(new Set(made));
  });

  it("refuses a page marker it did not make", async () => {
    const a = await signedIn();
    for (const cursor of ["nonsense", "AAAA", "bm90fGEK"]) {
      const res = await a.get(`/reports?cursor=${cursor}`);
      expect(res.status, cursor).toBe(400);
      expect(res.body.error.code).toBe("bad_cursor");
    }
  });

  it("opens one with the conversation, how many people reported them, and any ban", async () => {
    const a = await signedIn();
    const reported = visitorId();
    const first = await addReport({ reported });
    await addReport({ reported }); // a different reporter
    await addReport({ reported, reporter: "system" }); // automatic: does not count as a person
    await addReport({ reported, reporter: reported }); // from their own address: does not count
    await addReport({ reported, createdAt: new Date(Date.now() - 3 * DAY) }); // too old for "today"
    await db.ban.create({
      data: { visitor: reported, until: new Date(Date.now() + HOUR), reason: "reports" },
    });

    const res = await a.get(`/reports/${first.id}`);
    expect(res.status).toBe(200);
    const r = res.body.report;
    expect(r.transcript).toEqual([
      { who: "reporter", x: "hi" },
      { who: "reported", x: "rude words" },
    ]);
    expect(r.reportersToday).toBe(2);
    expect(r.reportsTotal).toBe(5);
    expect(r.ban).toMatchObject({ tag: reported.slice(0, 8), reason: "reports" });
  });

  it("shows no ban once it has run out", async () => {
    const a = await signedIn();
    const reported = visitorId();
    const r = await addReport({ reported });
    await db.ban.create({
      data: { visitor: reported, until: new Date(Date.now() - 1000), reason: "rules" },
    });
    expect((await a.get(`/reports/${r.id}`)).body.report.ban).toBeNull();
  });

  it("only returns well-formed lines, whatever is stored", async () => {
    const a = await signedIn();
    const r = await addReport({
      transcript: [
        { who: "reporter", x: "ok" },
        { who: "hacker", x: "bad who" },
        { who: "reported" },
        "just a string",
        null,
        { who: "reported", x: 42 },
        { who: "reported", x: "<script>alert(1)</script>" },
      ],
    });
    const res = await a.get(`/reports/${r.id}`);
    expect(res.body.report.transcript).toEqual([
      { who: "reporter", x: "ok" },
      { who: "reported", x: "<script>alert(1)</script>" }, // returned as plain text; the page shows it as text
    ]);
    const odd = await addReport({ transcript: "not even a list" });
    expect((await a.get(`/reports/${odd.id}`)).body.report.transcript).toEqual([]);
  });

  it("answers 404 for a report that is not there", async () => {
    const a = await signedIn();
    expect((await a.get("/reports/nope")).status).toBe(404);
    expect((await a.post("/reports/nope/ban", { hours: 24 })).status).toBe(404);
    expect((await a.post("/reports/nope/dismiss")).status).toBe(404);
    expect((await a.post("/reports/nope/reopen")).status).toBe(404);
  });

  it("dismisses and reopens, and logs both without the person's full ID", async () => {
    const a = await signedIn();
    const r = await addReport();
    const dismissed = await a.post(`/reports/${r.id}/dismiss`);
    expect(dismissed.body.report.status).toBe("dismissed");
    expect((await a.get("/reports")).body.items).toHaveLength(0);
    const reopened = await a.post(`/reports/${r.id}/reopen`);
    expect(reopened.body.report.status).toBe("open");
    const logged = await until(async () => {
      const rows = await db.event.findMany({ where: { kind: "admin" } });
      return rows.length >= 2 && rows;
    });
    expect(logged.map((e) => e.type).sort()).toEqual(["report_dismissed", "report_reopened"]);
    expect(
      JSON.stringify(logged, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain(r.reported);
  });

  it("bans the reported person for the time chosen, closes their open reports, and logs it", async () => {
    const a = await signedIn();
    const reported = visitorId();
    const one = await addReport({ reported });
    const two = await addReport({ reported });
    const other = await addReport(); // someone else's report stays open
    const res = await a.post(`/reports/${one.id}/ban`, { hours: 72 });
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe("banned");
    expect(res.body.report.ban.reason).toBe("rules");
    // it says which reports it closed, so they can all be put back on Undo (the other person's is not among them)
    expect([...res.body.settled].sort()).toEqual([one.id, two.id].sort());

    const ban = await db.ban.findUniqueOrThrow({ where: { visitor: reported } });
    expect(ban.until.getTime() - Date.now()).toBeGreaterThan(71.9 * HOUR);
    expect(ban.until.getTime() - Date.now()).toBeLessThan(72.1 * HOUR);
    expect((await db.report.findUniqueOrThrow({ where: { id: two.id } })).status).toBe("banned");
    expect((await db.report.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("open");

    const logged = await until(async () => db.event.findFirst({ where: { type: "ban" } }));
    expect(logged).toMatchObject({
      kind: "admin",
      visitor: reported.slice(0, 8),
      detail: "72h, rules",
    });
  });

  it("removes a connected person at once when they are banned", async () => {
    const a = await signedIn();
    const reported = "c0ffee".padEnd(24, "0");
    a.engine.connect("live-1", reported);
    await a.engine.handle("live-1", { t: "hello", adult: true, mode: "text", tags: [] });
    const r = await addReport({ reported });
    await a.post(`/reports/${r.id}/ban`, { hours: 24 });
    expect(a.kicked).toContain("live-1");
  });

  it("refuses a ban of no time, too long, or not a number", async () => {
    const a = await signedIn();
    const r = await addReport();
    for (const hours of [0, -5, 8761, 1.5, "24", null]) {
      expect((await a.post(`/reports/${r.id}/ban`, { hours })).status, String(hours)).toBe(400);
    }
    expect(await db.ban.count()).toBe(0);
  });
});

describe("bans", () => {
  it("lists only bans still in force, and lifts one, and says so if it is already gone", async () => {
    const a = await signedIn();
    const live = visitorId();
    const over = visitorId();
    await db.ban.create({
      data: { visitor: live, until: new Date(Date.now() + 3 * HOUR), reason: "age" },
    });
    await db.ban.create({
      data: { visitor: over, until: new Date(Date.now() - HOUR), reason: "rules" },
    });

    const list = await a.get("/bans");
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: live, tag: live.slice(0, 8), reason: "age" });

    const lifted = await a.post("/bans/lift", { visitor: live });
    expect(lifted.status).toBe(200);
    expect(lifted.body.ban).toMatchObject({ id: live, reason: "age" });
    expect(await db.ban.count({ where: { visitor: live } })).toBe(0);
    expect((await a.post("/bans/lift", { visitor: live })).status).toBe(404);
    expect((await a.post("/bans/lift", {})).status).toBe(400);
  });

  it("puts a lifted ban back as it was (Undo)", async () => {
    const a = await signedIn();
    const who = visitorId();
    const until = Date.now() + 5 * HOUR;
    await db.ban.create({ data: { visitor: who, until: new Date(until), reason: "age" } });
    const { ban } = (await a.post("/bans/lift", { visitor: who })).body;
    const back = await a.post("/bans/restore", {
      visitor: ban.id,
      until: ban.until,
      reason: ban.reason,
    });
    expect(back.status).toBe(200);
    const row = await db.ban.findUniqueOrThrow({ where: { visitor: who } });
    expect(row.reason).toBe("age");
    expect(Math.abs(row.until.getTime() - until)).toBeLessThan(HOUR + 1000); // rounded up to a whole hour
  });

  it("will not 'restore' a ban that would already be over, or has an unknown reason", async () => {
    const a = await signedIn();
    const who = visitorId();
    expect(
      (await a.post("/bans/restore", { visitor: who, until: Date.now() - 1000, reason: "rules" }))
        .status,
    ).toBe(400);
    expect(
      (await a.post("/bans/restore", { visitor: who, until: Date.now() + HOUR, reason: "fun" }))
        .status,
    ).toBe(400);
    expect(await db.ban.count({ where: { visitor: who } })).toBe(0);
  });
});

describe("users", () => {
  const accounts = () =>
    new Accounts({
      store: prismaUsers(db),
      hasher: argon2,
      events: prismaEvents(db, silent),
      limiter: new Limiter(),
    });
  const make = async (name: string) => {
    const email = `${name.toLowerCase()}${unique()}@admin.test`;
    const user = await accounts().register(
      { email, name, password: "correct horse", gender: "m", adult: true },
      `gv-${unique()}`,
    );
    return { id: user.id, email };
  };

  it("lists newest first and finds people by part of their name or email, ignoring case", async () => {
    const a = await signedIn();
    const needle = `Zed${unique()}`;
    const one = await make(needle);
    await make("Someone Else");
    const found = await a.get(`/users?q=${needle.toLowerCase()}`);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({
      id: one.id,
      email: one.email,
      hasPassword: true,
      google: false,
      suspended: false,
    });
    const byEmail = await a.get(
      `/users?q=${encodeURIComponent(one.email.slice(0, 12).toUpperCase())}`,
    );
    expect(byEmail.body.items.map((u: { id: string }) => u.id)).toContain(one.id);
    expect(JSON.stringify(found.body)).not.toContain("passwordHash");
    expect(JSON.stringify(found.body)).not.toContain("argon2");
  });

  it("pages through all users once", async () => {
    const a = await signedIn();
    const tag = `Pg${unique()}`;
    const ids = [];
    for (let i = 0; i < 5; i++) ids.push((await make(`${tag}n${i}`)).id);
    const seen: string[] = [];
    let cursor = "";
    for (let i = 0; i < 10; i++) {
      const res = await a.get(`/users?q=${tag}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.items.map((u: { id: string }) => u.id));
      if (!res.body.next) break;
      cursor = res.body.next;
    }
    expect(new Set(seen)).toEqual(new Set(ids));
    expect(seen).toHaveLength(5);
  });

  it("suspends: the person can't sign in and their old sign-in stops working; restoring lets them back", async () => {
    const a = await signedIn();
    const u = await make("Suspendee");
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const res = await a.post(`/users/${u.id}/suspend`);
    expect(res.body.user.suspended).toBe(true);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.disabledAt).not.toBeNull();
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    await expect(accounts().login(u.email, "correct horse", "gv-s")).rejects.toMatchObject({
      code: "suspended",
    });

    const back = await a.post(`/users/${u.id}/unsuspend`);
    expect(back.body.user.suspended).toBe(false);
    await expect(accounts().login(u.email, "correct horse", "gv-s")).resolves.toBeDefined();
  });

  it("resets a password: shows a new one once, signs them out, and the old one stops working", async () => {
    const a = await signedIn();
    const u = await make("Locked");
    const before = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    const res = await a.post(`/users/${u.id}/reset-password`);
    expect(res.status).toBe(200);
    const temp = res.body.password as string;
    expect(temp).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect(after.passwordHash).not.toContain(temp);
    await expect(accounts().login(u.email, "correct horse", "gv-r")).rejects.toMatchObject({
      code: "bad_credentials",
    });
    await expect(accounts().login(u.email, temp, "gv-r")).resolves.toBeDefined();

    // the activity log says it happened, but never the password
    const logged = await until(() =>
      db.event.findFirst({ where: { type: "user_password_reset" } }),
    );
    expect(logged.kind).toBe("admin");
    expect(
      JSON.stringify(logged, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    ).not.toContain(temp);
  });

  it("gives a Google-only person a password too", async () => {
    const a = await signedIn();
    const user = await db.user.create({
      data: {
        email: `g${unique()}@admin.test`,
        displayName: "Googler",
        googleSub: `g-${unique()}`,
        passwordHash: null,
        signupRef: "r",
      },
    });
    const res = await a.post(`/users/${user.id}/reset-password`);
    expect(res.body.user).toMatchObject({ hasPassword: true, google: true });
  });

  it("answers 404 for an account that is not there", async () => {
    const a = await signedIn();
    for (const action of ["suspend", "unsuspend", "reset-password"]) {
      expect((await a.post(`/users/nope/${action}`)).status, action).toBe(404);
    }
  });
});

describe("the activity log", () => {
  async function seed() {
    const base = Date.now() - 10 * HOUR;
    const rows = [
      { kind: "user", type: "register", visitor: "11111111", detail: "" },
      { kind: "user", type: "login_failed", visitor: "22222222", detail: "" },
      { kind: "admin", type: "admin_login", visitor: "33333333", detail: "" },
      { kind: "system", type: "error", visitor: "", detail: "a request failed (TypeError)" },
      { kind: "system", type: "warning", visitor: "", detail: "google sign-in failed" },
      { kind: "user", type: "report", visitor: "11111111", detail: "spam against 44444444" },
    ] as const;
    for (const [i, r] of rows.entries()) {
      await db.event.create({ data: { ...r, at: new Date(base + i * 1000) } });
    }
  }

  it("lists newest first with IDs as text", async () => {
    const a = await signedIn();
    await seed();
    const res = await a.get("/events");
    expect(res.body.items.map((e: { type: string }) => e.type)).toEqual([
      "report",
      "warning",
      "error",
      "admin_login",
      "login_failed",
      "register",
    ]);
    expect(typeof res.body.items[0].id).toBe("string");
    expect(res.body.items[0].id).toMatch(/^\d+$/);
  });

  it("filters by kind, and by text in the type, detail or the start of a visitor tag", async () => {
    const a = await signedIn();
    await seed();
    expect((await a.get("/events?kind=system")).body.items).toHaveLength(2);
    expect((await a.get("/events?kind=admin")).body.items).toHaveLength(1);
    expect((await a.get("/events?kind=bogus")).body.items).toHaveLength(6); // unknown kinds are ignored
    expect((await a.get("/events?q=LOGIN")).body.items).toHaveLength(2); // type, any case
    expect((await a.get("/events?q=google")).body.items).toHaveLength(1); // detail
    expect((await a.get("/events?q=1111")).body.items).toHaveLength(2); // visitor tag start
    expect((await a.get("/events?q=against 4444")).body.items).toHaveLength(1);
    expect((await a.get("/events?kind=user&q=1111")).body.items).toHaveLength(2);
    expect((await a.get("/events?q=nothing-matches-this")).body.items).toHaveLength(0);
  });

  it("treats search text as text, not as a database pattern", async () => {
    const a = await signedIn();
    await seed();
    for (const q of ["%", "_", "'; DROP TABLE events; --", "\\"]) {
      const res = await a.get(`/events?q=${encodeURIComponent(q)}`);
      expect(res.status, q).toBe(200);
    }
    expect(await db.event.count()).toBe(6);
  });

  it("pages by ID and ends cleanly", async () => {
    const a = await signedIn();
    await seed();
    const one = await a.get("/events?limit=4");
    expect(one.body.items).toHaveLength(4);
    expect(one.body.next).toMatch(/^\d+$/);
    const two = await a.get(`/events?limit=4&cursor=${one.body.next}`);
    expect(two.body.items).toHaveLength(2);
    expect(two.body.next).toBeNull();
    expect((await a.get("/events?cursor=abc")).status).toBe(400);
    expect((await a.get("/events?cursor=99999999999999999999999")).status).toBe(400);
  });

  it("downloads as CSV with a header row, newest first, and respects the filter", async () => {
    const a = await signedIn();
    await seed();
    const res = await a.get("/events.csv?kind=system");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="activity-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    const lines = res.text.replace("\ufeff", "").trim().split("\r\n");
    expect(lines[0]).toBe("id,time,kind,type,visitor,detail");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(",system,warning,");
    expect(lines[2]).toContain(",system,error,");
  });

  it("defuses formulas and keeps commas and quotes intact in the CSV", async () => {
    const a = await signedIn();
    await db.event.create({
      data: { kind: "user", type: "x", visitor: "", detail: '=HYPERLINK("http://evil","click")' },
    });
    await db.event.create({ data: { kind: "user", type: "y", visitor: "", detail: 'a,b "c"' } });
    const text = (await a.get("/events.csv")).text;
    expect(text).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
    expect(text).toContain('"a,b ""c"""');
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it("only includes the days asked for", async () => {
    const a = await signedIn();
    await db.event.create({
      data: { kind: "user", type: "ancient", at: new Date(Date.now() - 20 * DAY) },
    });
    await db.event.create({
      data: { kind: "user", type: "recent", at: new Date(Date.now() - 1 * DAY) },
    });
    const week = (await a.get("/events.csv?days=7")).text;
    expect(week).toContain("recent");
    expect(week).not.toContain("ancient");
    expect((await a.get("/events.csv?days=30")).text).toContain("ancient");
  });

  it("can stop after a maximum number of rows", async () => {
    await seed();
    const data = new AdminData(db, argon2);
    const seen: number[] = [];
    for await (const page of data.eachEventPage({}, 5, 2)) seen.push(page.length);
    expect(seen).toEqual([2, 2, 1]);
  });

  it("notes that an export was made", async () => {
    const a = await signedIn();
    await a.get("/events.csv");
    const logged = await until(() => db.event.findFirst({ where: { type: "events_exported" } }));
    expect(logged.kind).toBe("admin");
  });
});

describe("the system page", () => {
  it("reports health, settings without secrets, row counts, and only real problems", async () => {
    const a = await signedIn();
    await db.event.create({ data: { kind: "system", type: "error", detail: "boom" } });
    await db.event.create({ data: { kind: "system", type: "ban", detail: "24h, reports" } });
    await db.event.create({
      data: { kind: "user", type: "error", detail: "not a system problem" },
    });
    const res = await a.get("/system");
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.version).toBe("9.9.9");
    expect(s.database.up).toBe(true);
    expect(s.settings).toMatchObject({ siteName: "Test Site", googleSignIn: true, turn: false });
    expect(s.retention).toEqual({ eventDays: 30, reportDays: 90 });
    expect(s.counts.events).toBe(3);
    expect(s.problems.map((p: { detail: string }) => p.detail)).toEqual(["boom"]);
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
    const text = JSON.stringify(s);
    expect(text).not.toContain(CREDS.key);
    expect(text).not.toContain("SESSION_SECRET");
  });
});

describe("removing old data", () => {
  it("deletes what is past its date and keeps the rest", async () => {
    const now = Date.now();
    const old = (days: number) => new Date(now - days * DAY);
    await db.event.create({ data: { kind: "user", type: "old", at: old(31) } });
    await db.event.create({ data: { kind: "user", type: "fresh", at: old(29) } });
    await addReport({ createdAt: old(91), status: "open" }); // even an unreviewed report goes in the end
    const keptReport = await addReport({ createdAt: old(89), status: "dismissed" });
    await db.hourlyStat.create({ data: { hour: old(401), chats: 1 } });
    await db.hourlyStat.create({ data: { hour: old(399), chats: 1 } });
    await db.ban.create({ data: { visitor: visitorId(), until: old(8), reason: "rules" } });
    const recentBan = visitorId();
    await db.ban.create({ data: { visitor: recentBan, until: old(2), reason: "rules" } });
    const liveBan = visitorId();
    await db.ban.create({
      data: { visitor: liveBan, until: new Date(now + DAY), reason: "rules" },
    });

    const gone = await runRetention(db, { eventDays: 30, reportDays: 90 }, now);
    expect(gone).toEqual({ events: 1, reports: 1, stats: 1, bans: 1 });
    expect((await db.event.findMany()).map((e) => e.type)).toEqual(["fresh"]);
    expect((await db.report.findMany()).map((r) => r.id)).toEqual([keptReport.id]);
    expect(await db.hourlyStat.count()).toBe(1);
    expect((await db.ban.findMany()).map((b) => b.visitor).sort()).toEqual(
      [liveBan, recentBan].sort(),
    );
  });

  it("does nothing when nothing is old, and is safe to run again", async () => {
    await db.event.create({ data: { kind: "user", type: "fresh" } });
    expect(await runRetention(db, { eventDays: 30, reportDays: 90 })).toEqual({
      events: 0,
      reports: 0,
      stats: 0,
      bans: 0,
    });
  });
});

describe("a bad page marker", () => {
  it("is a BadCursor error at the data layer", async () => {
    const data = new AdminData(db, argon2);
    await expect(
      data.listReports({ status: "open", cursor: "zzz", limit: 5 }),
    ).rejects.toBeInstanceOf(BadCursor);
    await expect(data.listEvents({ cursor: "-1", limit: 5 })).rejects.toBeInstanceOf(BadCursor);
  });
});
