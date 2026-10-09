import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Limiter } from "../src/auth/limiter.js";
import { argon2 } from "../src/auth/passwords.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { Accounts, AuthError } from "../src/auth/service.js";
import { prismaUsers } from "../src/auth/store.js";
import { prismaBans } from "../src/chat/stores.js";
import { createDb, type Db } from "../src/db.js";
import { prismaEvents } from "../src/events.js";
import { silent, testConfig } from "./helpers.js";

let db: Db;
beforeAll(() => {
  db = createDb(process.env.DATABASE_URL!);
});
afterAll(async () => {
  await db.$disconnect();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let counter = 0;
/** An email nobody else in these tests uses. */
const fresh = () => `person${++counter}-${Date.now()}@auth.test`;

function realAccounts() {
  return new Accounts({
    store: prismaUsers(db),
    hasher: argon2,
    events: prismaEvents(db, silent),
    limiter: new Limiter(),
  });
}
const input = (email = fresh()) => ({
  email,
  name: "Sam",
  password: "correct horse",
  adult: true as const,
});

describe("accounts in Postgres, with real argon2", () => {
  it("stores an argon2id hash and a lower-case email, never the password", async () => {
    const accounts = realAccounts();
    const email = fresh();
    const user = await accounts.register(input(email), "visitor-a");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(JSON.stringify(row)).not.toContain("correct horse");
    expect(row.email).toBe(email);
    expect(row).toMatchObject({
      displayName: "Sam",
      loginCount: 0,
      sessionVersion: 1,
      signupRef: "visitor-a",
    });
    expect(row.premiumUntil).toBeNull();
    expect(row.disabledAt).toBeNull();
  });

  it("lets the database decide when two sign-ups with one email race: exactly one wins", async () => {
    const accounts = realAccounts();
    const email = fresh();
    const results = await Promise.allSettled([
      accounts.register(input(email), "race-1"),
      accounts.register(input(email), "race-2"),
      accounts.register(input(email), "race-3"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect(((r as PromiseRejectedResult).reason as AuthError).code).toBe("duplicate_email");
    }
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  it("signs in, counts it, and refuses the wrong password", async () => {
    const accounts = realAccounts();
    const email = fresh();
    await accounts.register(input(email), "v1");
    const user = await accounts.login(email, "correct horse", "v1");
    expect(user.loginCount).toBe(1);
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    await expect(accounts.login(email, "wrong password", "v1")).rejects.toMatchObject({
      code: "bad_credentials",
    });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).loginCount).toBe(1);
  });

  it("raises the session version when the password changes, so every old cookie dies", async () => {
    const accounts = realAccounts();
    const email = fresh();
    const user = await accounts.register(input(email), "v1");
    const updated = await accounts.changePassword(user, "correct horse", "brand new pass", "v1");
    expect(updated.sessionVersion).toBe(2);
    const row = await db.user.findUniqueOrThrow({ where: { email } });
    expect(row.sessionVersion).toBe(2);
    expect(await argon2.verify(row.passwordHash!, "brand new pass")).toBe(true);
    expect(await argon2.verify(row.passwordHash!, "correct horse")).toBe(false);
  });

  it("deletes the account but keeps a paid pass record, no longer tied to anyone", async () => {
    const accounts = realAccounts();
    const email = fresh();
    const user = await accounts.register(input(email), "v1");
    const sessionId = `cs_test_${email}`;
    await db.passClaim.create({
      data: { sessionId, until: new Date(Date.now() + 3600e3), userId: user.id },
    });
    await accounts.deleteAccount(user, { password: "correct horse" }, "v1");
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect((await db.passClaim.findUniqueOrThrow({ where: { sessionId } })).userId).toBeNull();
    // and the email can be used again
    await realAccounts().register(input(email), "v2");
  });

  it("writes the activity log with short visitor IDs and without emails or passwords", async () => {
    const accounts = realAccounts();
    const email = fresh();
    const visitor = "0123456789abcdef01234567"; // a full 24-character scrambled ID
    const user = await accounts.register(input(email), visitor);
    await accounts.login(email, "correct horse", visitor);
    await expect(accounts.login(email, "nope", visitor)).rejects.toBeInstanceOf(AuthError);
    await accounts.changePassword(user, "correct horse", "brand new pass", visitor);
    await wait(300); // events are written in the background

    const rows = await db.event.findMany({
      where: {
        visitor: visitor.slice(0, 8),
        type: { in: ["register", "login", "login_failed", "password_changed"] },
      },
    });
    expect(rows.map((r) => r.type).sort()).toEqual([
      "login",
      "login_failed",
      "password_changed",
      "register",
    ]);
    for (const row of rows) {
      const { id: _id, ...r } = row; // the numeric id is a BigInt, which JSON cannot print
      expect(r.kind).toBe("user");
      expect(r.visitor).toBe("01234567"); // only the first 8 characters are kept
      expect(JSON.stringify(r)).not.toContain(email);
      expect(JSON.stringify(r)).not.toContain("correct horse");
      expect(JSON.stringify(r)).not.toContain("brand new pass");
      expect(JSON.stringify(r)).not.toContain(visitor);
    }
  });
});

describe("the whole thing over HTTP, against Postgres", () => {
  const app = () =>
    createApp({
      config: testConfig(),
      logger: silent,
      health: { ping: async () => true },
      online: () => 0,
      auth: createAuthRouter({
        accounts: realAccounts(),
        store: prismaUsers(db),
        bans: prismaBans(db),
        secret: "http-int-test-secret-123456",
        visitorOf: (ip) => `visitor:${ip}`,
        publicUrl: "http://localhost:5173",
      }),
    });
  const cookie = (res: request.Response) =>
    ((res.headers["set-cookie"] as unknown as string[])[0] ?? "").split(";")[0] ?? "";

  it("registers, is recognised, changes password (ending other sessions), downloads data, and deletes", async () => {
    const a = app();
    const email = fresh();
    const post = (path: string, body: object, c = "") =>
      request(a)
        .post(`/api/v1/auth${path}`)
        .set("X-Forwarded-For", "10.9.0.1")
        .set("Cookie", c)
        .send(body);

    const reg = await post("/register", input(email));
    expect(reg.status).toBe(200);
    const first = cookie(reg);
    const me = await request(a).get("/api/v1/auth/me").set("Cookie", first);
    expect(me.body.user).toMatchObject({ name: "Sam", email });

    const second = cookie(await post("/login", { email, password: "correct horse" }));
    expect(second).not.toBe("");

    const changed = await post(
      "/password",
      { password: "correct horse", next: "brand new pass" },
      first,
    );
    expect(changed.status).toBe(200);
    expect((await request(a).get("/api/v1/auth/me").set("Cookie", second)).body.user).toBeNull(); // the other browser is signed out
    const carry = cookie(changed);
    expect((await request(a).get("/api/v1/auth/me").set("Cookie", carry)).body.user).not.toBeNull();

    const data = await request(a).get("/api/v1/auth/export").set("Cookie", carry);
    expect(JSON.parse(data.text).account.email).toBe(email);
    expect(data.text).not.toContain("argon2");

    const del = await post("/delete", { password: "brand new pass" }, carry);
    expect(del.status).toBe(200);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect((await request(a).get("/api/v1/auth/me").set("Cookie", carry)).body.user).toBeNull();
  });

  it("will not sign in someone a moderator has suspended, and ends their cookie at once", async () => {
    const a = app();
    const email = fresh();
    const reg = await request(a)
      .post("/api/v1/auth/register")
      .set("X-Forwarded-For", "10.9.0.2")
      .send(input(email));
    const c = cookie(reg);
    await db.user.update({
      where: { email },
      data: { disabledAt: new Date(), sessionVersion: { increment: 1 } },
    });
    expect((await request(a).get("/api/v1/auth/me").set("Cookie", c)).body.user).toBeNull();
    const login = await request(a)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", "10.9.0.3")
      .send({ email, password: "correct horse" });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("suspended");
  });

  it("refuses a banned visitor from creating an account, using the real ban table", async () => {
    const a = app();
    await prismaBans(db).add("visitor:10.9.0.4", 24, "age");
    const email = fresh();
    const res = await request(a)
      .post("/api/v1/auth/register")
      .set("X-Forwarded-For", "10.9.0.4")
      .send(input(email));
    expect(res.status).toBe(403);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });
});
