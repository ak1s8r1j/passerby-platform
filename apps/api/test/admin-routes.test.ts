import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAdminRouter, LOGIN_MAX_PER_ADDRESS, LOGIN_MAX_TOTAL } from "../src/admin/routes.js";
import type { AdminData } from "../src/admin/data.js";
import { createApp } from "../src/app.js";
import { Limiter } from "../src/auth/limiter.js";
import { MemoryEvents } from "./chat-helpers.js";
import { silent, testConfig } from "./helpers.js";

const CREDS = { user: "owner", key: "a-long-secret-key-123" };

/** Data that must never be reached: any use fails the test. */
const untouchable = new Proxy(
  {},
  {
    get(_t, name) {
      throw new Error(`the database was used (${String(name)}) when it should not have been`);
    },
  },
) as AdminData;

function build(
  over: { credentials?: typeof CREDS | null; limiter?: Limiter; data?: AdminData } = {},
) {
  const events = new MemoryEvents();
  const router = createAdminRouter({
    credentials: over.credentials === undefined ? CREDS : over.credentials,
    secret: "admin-route-secret-123456",
    publicUrl: "http://localhost:5173",
    visitorOf: (ip) => `visitor:${ip}`,
    data: over.data ?? untouchable,
    live: () => ({ online: 0, text: 0, video: 0, searching: 0, chatting: 0 }),
    ban: async () => undefined,
    events,
    health: { ping: async () => true },
    limiter: over.limiter,
    info: {
      version: "t",
      siteName: "T",
      publicUrl: "http://localhost:5173",
      video: true,
      googleSignIn: false,
      turn: false,
      contact: false,
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
  return { app, events };
}

const api = (path: string) => `/api/v1/admin${path}`;
const cookieOf = (res: request.Response) => {
  const raw = (res.headers["set-cookie"] as unknown as string[] | undefined)?.[0] ?? "";
  return raw.split(";")[0]!;
};

async function signIn(app: ReturnType<typeof build>["app"], address = "10.0.0.1") {
  const res = await request(app)
    .post(api("/login"))
    .set("X-Forwarded-For", address)
    .send({ user: CREDS.user, key: CREDS.key });
  return { res, cookie: cookieOf(res) };
}

const PROTECTED_GETS = [
  "/overview",
  "/reports",
  "/reports/abc",
  "/bans",
  "/users",
  "/events",
  "/events.csv",
  "/system",
];
const PROTECTED_POSTS = [
  ["/reports/abc/ban", { hours: 24 }],
  ["/reports/abc/dismiss", {}],
  ["/reports/abc/reopen", {}],
  ["/bans/lift", { visitor: "v" }],
  ["/bans/restore", { visitor: "v", until: Date.now() + 1e7, reason: "rules" }],
  ["/users/abc/suspend", {}],
  ["/users/abc/unsuspend", {}],
  ["/users/abc/reset-password", {}],
] as const;

describe("when no ADMIN_KEY is set", () => {
  it("says so on /me and answers 'not set up' everywhere else", async () => {
    const { app } = build({ credentials: null });
    const me = await request(app).get(api("/me"));
    expect(me.body).toEqual({ enabled: false, admin: null });
    for (const path of PROTECTED_GETS) {
      const res = await request(app).get(api(path));
      expect(res.status, path).toBe(404);
      expect(res.body.error.code).toBe("admin_disabled");
    }
    const login = await request(app)
      .post(api("/login"))
      .send({ user: "owner", key: "whatever-1234" });
    expect(login.status).toBe(404);
  });
});

describe("without signing in", () => {
  it("refuses every page, and never touches the database", async () => {
    const { app } = build();
    for (const path of PROTECTED_GETS) {
      const res = await request(app).get(api(path));
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("not_signed_in");
    }
    for (const [path, body] of PROTECTED_POSTS) {
      const res = await request(app).post(api(path)).send(body);
      expect(res.status, path).toBe(401);
    }
  });

  it("says on /me that the admin area is on but nobody is signed in", async () => {
    const { app } = build();
    expect((await request(app).get(api("/me"))).body).toEqual({ enabled: true, admin: null });
  });

  it("refuses a made-up or edited cookie", async () => {
    const { app } = build();
    for (const cookie of ["pb_admin=abc", "pb_admin=a.1.b", "pb_admin=", "pb_sess=whatever"]) {
      const res = await request(app).get(api("/overview")).set("Cookie", cookie);
      expect(res.status, cookie).toBe(401);
    }
  });

  it("does not accept a visitor's account cookie as an admin one", async () => {
    const { app } = build();
    const res = await request(app).get(api("/overview")).set("Cookie", "pb_sess=1.2.3.4");
    expect(res.status).toBe(401);
  });
});

describe("signing in", () => {
  it("works with the right name and key, and sets a cookie scripts can't read", async () => {
    const { app } = build();
    const { res } = await signIn(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, admin: "owner" });
    const set = (res.headers["set-cookie"] as unknown as string[])[0]!;
    expect(set).toMatch(/^pb_admin=/);
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Strict/i);
    expect(set).toMatch(/Path=\/api\/v1\/admin/);
    expect(set).toMatch(/Max-Age=43200/); // 12 hours
  });

  it("then lets /me and protected pages through (the data layer is reached)", async () => {
    const { app } = build({
      data: {
        overview: async () => ({ marker: "reached" }),
      } as unknown as AdminData,
    });
    const { cookie } = await signIn(app);
    expect((await request(app).get(api("/me")).set("Cookie", cookie)).body.admin).toBe("owner");
    const res = await request(app).get(api("/overview")).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.marker).toBe("reached");
  });

  it("gives the same answer for a wrong name and a wrong key", async () => {
    const { app } = build();
    const wrongName = await request(app).post(api("/login")).send({ user: "nope", key: CREDS.key });
    const wrongKey = await request(app)
      .post(api("/login"))
      .send({ user: CREDS.user, key: "wrong-key-12345" });
    expect(wrongName.status).toBe(401);
    expect(wrongKey.status).toBe(401);
    expect(wrongName.body).toEqual(wrongKey.body);
    expect(wrongName.headers["set-cookie"]).toBeUndefined();
  });

  it("is not fooled by a key that only starts like the real one, or the real one with extra", async () => {
    const { app } = build();
    for (const key of [
      CREDS.key.slice(0, -1),
      CREDS.key + "x",
      CREDS.key.toUpperCase(),
      " " + CREDS.key,
    ]) {
      const res = await request(app).post(api("/login")).send({ user: CREDS.user, key });
      expect(res.status, key).toBe(401);
    }
  });

  it("answers 400 to a request with missing or wrongly typed fields, not a crash", async () => {
    const { app } = build();
    for (const body of [
      {},
      { user: "owner" },
      { key: "x" },
      { user: 1, key: 2 },
      { user: "", key: "" },
    ]) {
      const res = await request(app).post(api("/login")).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("ends the sign-in on sign out, so a copied cookie stops working", async () => {
    const { app } = build({ data: { overview: async () => ({}) } as unknown as AdminData });
    const { cookie } = await signIn(app);
    const out = await request(app).post(api("/logout")).set("Cookie", cookie);
    expect(out.status).toBe(200);
    const after = await request(app).get(api("/overview")).set("Cookie", cookie); // the same copied cookie
    expect(after.status).toBe(401);
    expect((await request(app).get(api("/me")).set("Cookie", cookie)).body.admin).toBeNull();
  });

  it("lets two sign-ins live side by side", async () => {
    const { app } = build({ data: { overview: async () => ({}) } as unknown as AdminData });
    const one = await signIn(app, "10.0.0.1");
    const two = await signIn(app, "10.0.0.2");
    await request(app).post(api("/logout")).set("Cookie", one.cookie);
    expect((await request(app).get(api("/overview")).set("Cookie", two.cookie)).status).toBe(200);
  });
});

describe("guessing the key", () => {
  const wrong = (app: ReturnType<typeof build>["app"], address: string) =>
    request(app)
      .post(api("/login"))
      .set("X-Forwarded-For", address)
      .send({ user: CREDS.user, key: "wrong-key-12345" });

  it(`locks an address out after ${LOGIN_MAX_PER_ADDRESS} wrong tries, even for the right key`, async () => {
    const { app } = build();
    for (let i = 0; i < LOGIN_MAX_PER_ADDRESS; i++)
      expect((await wrong(app, "10.1.1.1")).status).toBe(401);
    expect((await wrong(app, "10.1.1.1")).status).toBe(429);
    const right = await signIn(app, "10.1.1.1");
    expect(right.res.status).toBe(429);
    expect(right.cookie).toBe("");
  });

  it("doesn't lock out a different address", async () => {
    const { app } = build();
    for (let i = 0; i < LOGIN_MAX_PER_ADDRESS + 2; i++) await wrong(app, "10.1.1.1");
    expect((await signIn(app, "10.1.1.2")).res.status).toBe(200);
  });

  it(`stops everyone after ${LOGIN_MAX_TOTAL} wrong tries from many addresses`, async () => {
    const { app } = build({ limiter: new Limiter() });
    for (let i = 0; i < LOGIN_MAX_TOTAL; i++)
      await wrong(app, `10.2.${Math.floor(i / 200)}.${i % 200}`);
    expect((await signIn(app, "10.9.9.9")).res.status).toBe(429);
  });

  it("lets the owner back in once the window has passed", async () => {
    let t = 1_800_000_000_000;
    const limiter = new Limiter(() => t);
    const { app } = build({ limiter });
    for (let i = 0; i < LOGIN_MAX_PER_ADDRESS; i++) await wrong(app, "10.1.1.1");
    expect((await signIn(app, "10.1.1.1")).res.status).toBe(429);
    t += 16 * 60_000;
    expect((await signIn(app, "10.1.1.1")).res.status).toBe(200);
  });
});

describe("the activity log of sign-ins", () => {
  it("records successes and failures, never the key", async () => {
    const { app, events } = build();
    await request(app).post(api("/login")).send({ user: "owner", key: "wrong-key-12345" });
    await signIn(app);
    const types = events.recorded.map((e) => e.type);
    expect(types).toEqual(["admin_login_failed", "admin_login"]);
    expect(events.recorded.every((e) => e.kind === "admin")).toBe(true);
    const everything = JSON.stringify(events.recorded);
    expect(everything).not.toContain(CREDS.key);
    expect(everything).not.toContain("wrong-key-12345");
  });
});

describe("requests from other websites", () => {
  it("refuses a POST whose Origin is another site", async () => {
    const { app } = build();
    const res = await request(app)
      .post(api("/login"))
      .set("Origin", "https://evil.example")
      .send({ user: CREDS.user, key: CREDS.key });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("bad_origin");
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("refuses protected changes from another site even with a valid cookie", async () => {
    const { app } = build();
    const { cookie } = await signIn(app);
    const res = await request(app)
      .post(api("/bans/lift"))
      .set("Cookie", cookie)
      .set("Origin", "https://evil.example")
      .send({ visitor: "v" });
    expect(res.status).toBe(403);
  });

  it("accepts the site's own origin", async () => {
    const { app } = build();
    const res = await request(app)
      .post(api("/login"))
      .set("Origin", "http://localhost:5173")
      .send({ user: CREDS.user, key: CREDS.key });
    expect(res.status).toBe(200);
  });
});

describe("what the responses say about themselves", () => {
  it("are never cached and keep search engines out", async () => {
    const { app } = build();
    const res = await request(app).get(api("/me"));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-robots-tag"]).toMatch(/noindex/);
  });
});
