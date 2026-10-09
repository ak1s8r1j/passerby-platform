import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { GoogleOAuth, type GoogleProfile } from "../src/auth/google.js";
import { Limiter } from "../src/auth/limiter.js";
import { argon2 } from "../src/auth/passwords.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { Accounts } from "../src/auth/service.js";
import { DuplicateEmailError, DuplicateGoogleError, prismaUsers } from "../src/auth/store.js";
import { prismaBans } from "../src/chat/stores.js";
import { createDb, type Db } from "../src/db.js";
import { prismaEvents } from "../src/events.js";
import { CLIENT_ID, CLIENT_SECRET, FakeGoogle, REDIRECT_URI } from "./fake-google.js";
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
const unique = () => `${Date.now()}-${++counter}`;
const freshEmail = () => `google${unique()}@authgoogle.test`;

function realAccounts() {
  return new Accounts({
    store: prismaUsers(db),
    hasher: argon2,
    events: prismaEvents(db, silent),
    limiter: new Limiter(),
  });
}
const profile = (over: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: `g-${unique()}`,
  email: freshEmail(),
  emailVerified: true,
  name: "Riley Q",
  ...over,
});
const ctx = (visitor = "gv-1") => ({ visitor, adult: true, banned: false });

describe("Google accounts in Postgres", () => {
  it("stores an account with no password and a Google id, and finds it by either", async () => {
    const store = prismaUsers(db);
    const p = profile();
    const user = await store.create({
      email: p.email,
      displayName: "Riley",
      passwordHash: null,
      googleSub: p.sub,
      signupRef: "r",
    });
    expect(user.passwordHash).toBeNull();
    expect((await store.findByGoogleSub(p.sub))!.id).toBe(user.id);
    expect((await store.findByEmail(p.email))!.id).toBe(user.id);
    expect(await store.findByGoogleSub("nobody")).toBeNull();
  });

  it("will not let two accounts share a Google id or an email, and says which", async () => {
    const store = prismaUsers(db);
    const p = profile();
    await store.create({
      email: p.email,
      displayName: "A",
      passwordHash: null,
      googleSub: p.sub,
      signupRef: "r",
    });
    await expect(
      store.create({
        email: freshEmail(),
        displayName: "B",
        passwordHash: null,
        googleSub: p.sub,
        signupRef: "r",
      }),
    ).rejects.toBeInstanceOf(DuplicateGoogleError);
    await expect(
      store.create({
        email: p.email,
        displayName: "C",
        passwordHash: null,
        googleSub: `other-${unique()}`,
        signupRef: "r",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("will not connect a Google id another account has, and can disconnect one", async () => {
    const store = prismaUsers(db);
    const p = profile();
    const a = await store.create({
      email: p.email,
      displayName: "A",
      passwordHash: "x",
      googleSub: p.sub,
      signupRef: "r",
    });
    const b = await store.create({
      email: freshEmail(),
      displayName: "B",
      passwordHash: "x",
      signupRef: "r",
    });
    await expect(store.setGoogleSub(b.id, p.sub)).rejects.toBeInstanceOf(DuplicateGoogleError);
    expect((await store.setGoogleSub(a.id, null)).googleSub).toBeNull();
    expect((await store.setGoogleSub(b.id, p.sub)).googleSub).toBe(p.sub); // free now
  });

  it("lets many accounts have no Google id at all (empty is not a duplicate)", async () => {
    const store = prismaUsers(db);
    for (let i = 0; i < 3; i++) {
      await store.create({
        email: freshEmail(),
        displayName: "N",
        passwordHash: "x",
        signupRef: "r",
      });
    }
  });

  it("makes exactly one account when the same person's Google sign-ins race, and signs all of them in", async () => {
    const accounts = realAccounts();
    const p = profile();
    const results = await Promise.all([
      accounts.googleSignIn(p, ctx("gv-race-1")),
      accounts.googleSignIn(p, ctx("gv-race-2")),
      accounts.googleSignIn(p, ctx("gv-race-3")),
    ]);
    expect(await db.user.count({ where: { googleSub: p.sub } })).toBe(1);
    expect(new Set(results.map((r) => r.user.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it("refuses to join Google to an existing password account with the same email", async () => {
    const accounts = realAccounts();
    const email = freshEmail();
    await accounts.register(
      { email, name: "Sam", password: "correct horse", adult: true },
      "gv-existing",
    );
    const p = profile({ email });
    await expect(accounts.googleSignIn(p, ctx("gv-victim"))).rejects.toMatchObject({
      code: "email_in_use",
    });
    expect((await db.user.findUniqueOrThrow({ where: { email } })).googleSub).toBeNull();
    expect(await db.user.count({ where: { googleSub: p.sub } })).toBe(0);
  });

  it("cannot be signed in to with a password when there is none", async () => {
    const accounts = realAccounts();
    const p = profile();
    await accounts.googleSignIn(p, ctx());
    await expect(accounts.login(p.email, "anything", "gv-guess")).rejects.toMatchObject({
      code: "bad_credentials",
    });
  });

  it("deletes a Google-only account by its email, and the Google id can be used again", async () => {
    const accounts = realAccounts();
    const p = profile();
    const { user } = await accounts.googleSignIn(p, ctx());
    await accounts.deleteAccount(user, { email: p.email }, "gv-1");
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect((await accounts.googleSignIn(p, ctx())).created).toBe(true);
  });

  it("writes the log for a Google sign-up without the email, the Google id or the name", async () => {
    const accounts = realAccounts();
    const p = profile();
    await accounts.googleSignIn(p, ctx("0123456789abcdef01234567"));
    await wait(300);
    const rows = await db.event.findMany({
      where: { visitor: "01234567", type: "google_register" },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const { id: _id, ...r } = row; // the numeric id is a BigInt, which JSON cannot print
      expect(JSON.stringify(r)).not.toContain(p.email);
      expect(JSON.stringify(r)).not.toContain(p.sub);
      expect(JSON.stringify(r)).not.toContain("Riley");
    }
  });
});

describe("the whole Google flow over HTTP, against Postgres and a stand-in Google", () => {
  it("signs up, sets a password, disconnects Google, and deletes the account", async () => {
    const google = await new FakeGoogle().start();
    try {
      const router = createAuthRouter({
        accounts: realAccounts(),
        store: prismaUsers(db),
        bans: prismaBans(db),
        secret: "http-int-google-secret-123456",
        visitorOf: (ip) => `visitor:${ip}`,
        publicUrl: "http://localhost:5173",
        google: new GoogleOAuth({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_SECRET,
          redirectUri: REDIRECT_URI,
          endpoints: google.endpoints,
        }),
      });
      const app = createApp({
        config: testConfig(),
        logger: silent,
        health: { ping: async () => true },
        online: () => 0,
        auth: router,
      });
      const apply = (res: request.Response, jar: Record<string, string> = {}) => {
        const out = { ...jar };
        for (const c of (res.headers["set-cookie"] as unknown as string[] | undefined) ?? []) {
          const [pair] = c.split(";") as [string];
          const i = pair.indexOf("=");
          if (pair.slice(i + 1)) out[pair.slice(0, i)] = pair.slice(i + 1);
          else delete out[pair.slice(0, i)];
        }
        return out;
      };
      const header = (jar: Record<string, string>) =>
        Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");

      const email = freshEmail();
      const person = { sub: `int-${unique()}`, email, name: "Riley Q" };
      const start = await request(app)
        .get("/api/v1/auth/google/start?adult=1")
        .set("X-Forwarded-For", "10.8.0.1");
      expect(start.status).toBe(302);
      const asked = FakeGoogle.requestFrom(start.headers.location!);
      const code = google.issueCode(person, { nonce: asked.nonce, challenge: asked.challenge });
      const back = await request(app)
        .get(`/api/v1/auth/google/callback?code=${code}&state=${asked.state}`)
        .set("X-Forwarded-For", "10.8.0.1")
        .set("Cookie", header(apply(start)));
      expect(back.headers.location).toBe("/account?google=created");
      let jar = apply(back, apply(start));

      const row = await db.user.findUniqueOrThrow({ where: { email } });
      expect(row).toMatchObject({
        passwordHash: null,
        googleSub: person.sub,
        displayName: "Riley Q",
      });

      const set = await request(app)
        .post("/api/v1/auth/password")
        .set("Cookie", header(jar))
        .send({ next: "brand new pass" });
      expect(set.status).toBe(200);
      jar = apply(set, jar);
      expect((await db.user.findUniqueOrThrow({ where: { email } })).passwordHash).toMatch(
        /^\$argon2id\$/,
      );

      expect(
        (await request(app).post("/api/v1/auth/google/unlink").set("Cookie", header(jar))).status,
      ).toBe(200);
      expect((await db.user.findUniqueOrThrow({ where: { email } })).googleSub).toBeNull();

      const del = await request(app)
        .post("/api/v1/auth/delete")
        .set("Cookie", header(jar))
        .send({ password: "brand new pass" });
      expect(del.status).toBe(200);
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
    } finally {
      await google.stop();
    }
  });
});
