import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { createSessionToken, SESSION_MS } from "../src/auth/session.js";
import { accountsWorld, SAM } from "./auth-helpers.js";
import { MemoryBans } from "./chat-helpers.js";
import { silent, testConfig } from "./helpers.js";

const SECRET = "route-test-secret-123456";
const PUBLIC_URL = "http://localhost:5173";
type Res = request.Response;

function build() {
  const w = accountsWorld();
  const bans = new MemoryBans();
  const router = createAuthRouter({
    accounts: w.accounts,
    store: w.store,
    bans,
    secret: SECRET,
    visitorOf: (ip) => `visitor:${ip}`,
    publicUrl: PUBLIC_URL,
  });
  const app = createApp({
    config: testConfig(),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
    auth: router,
  });
  let n = 0;
  /** A fresh address each time, like a different person. */
  const person = () => `10.0.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
  return { ...w, bans, app, person };
}

const api = (path: string) => `/api/v1/auth${path}`;
const cookieOf = (res: Res) =>
  ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? [])[0]?.split(";")[0] ?? "";
const setCookie = (res: Res) =>
  ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? [])[0] ?? "";

async function registered(w = build(), address = w.person(), body = SAM) {
  const res = await request(w.app)
    .post(api("/register"))
    .set("X-Forwarded-For", address)
    .send(body);
  return { w, address, res, cookie: cookieOf(res) };
}

describe("who am I", () => {
  it("says nobody to a visitor with no cookie", async () => {
    const { app } = build();
    const res = await request(app).get(api("/me"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it("says nobody for a forged, garbled or expired cookie", async () => {
    const w = build();
    const { w: world } = await registered(w);
    const user = [...world.store.users.values()][0]!;
    const expired = createSessionToken(SECRET, user, Date.now() - SESSION_MS - 1000);
    const forged = createSessionToken("some-other-secret-entirely", user);
    for (const bad of [
      "pb_sess=garbage",
      "pb_sess=",
      `pb_sess=${forged}`,
      `pb_sess=${expired}`,
      "pb_sess=a.b.c.d",
    ]) {
      const res = await request(world.app).get(api("/me")).set("Cookie", bad);
      expect(res.body, bad).toEqual({ user: null });
    }
  });

  it("is never cached, since it is personal", async () => {
    const { app } = build();
    expect((await request(app).get(api("/me"))).headers["cache-control"]).toBe("no-store");
  });
});

describe("creating an account", () => {
  it("signs the new person in, with a cookie scripts can't read", async () => {
    const { res, cookie } = await registered();
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: "Sam", email: "sam@example.com" });
    expect(res.body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const header = setCookie(res);
    expect(header).toMatch(/^pb_sess=/);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${SESSION_MS / 1000}`);
    expect(cookie.length).toBeGreaterThan(40);
  });

  it("marks the cookie Secure when the site is served over https, and only then", async () => {
    const w = build();
    const plain = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send(SAM);
    expect(setCookie(plain)).not.toContain("Secure");
    const secure = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .set("X-Forwarded-Proto", "https")
      .send({ ...SAM, email: "other@example.com" });
    expect(setCookie(secure)).toContain("Secure");
  });

  it("never sends back the password, the hash, or internal details", async () => {
    const { res } = await registered();
    const text = JSON.stringify(res.body);
    for (const leak of ["correct horse", "fake$", "passwordHash", "sessionVersion", "signupRef"]) {
      expect(text).not.toContain(leak);
    }
    expect(Object.keys(res.body.user).sort()).toEqual([
      "createdAt",
      "email",
      "google",
      "hasPassword",
      "name",
    ]);
  });

  it("makes the cookie work straight away", async () => {
    const { w, cookie } = await registered();
    const me = await request(w.app).get(api("/me")).set("Cookie", cookie);
    expect(me.body.user).toMatchObject({ name: "Sam", email: "sam@example.com" });
  });

  it.each([
    [{ adult: false }, "Confirm that you are 18 or older."],
    [{ adult: undefined }, "Confirm that you are 18 or older."],
    [{ email: "nope" }, "Enter a valid email address."],
    [{ name: "A" }, "Pick a name of 2 to 24 letters, numbers or spaces."],
    [{ name: "<script>" }, "Pick a name of 2 to 24 letters, numbers or spaces."],
    [{ password: "short" }, "Use a password of 8 to 128 characters."],
    [{ password: "x".repeat(129) }, "Use a password of 8 to 128 characters."],
  ])("refuses %j with a plain message and creates nothing", async (over, message) => {
    const w = build();
    const res = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send({ ...SAM, ...over });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "invalid", message } });
    expect(w.store.users.size).toBe(0);
    expect(setCookie(res)).toBe("");
  });

  it("refuses broken or missing request bodies cleanly", async () => {
    const w = build();
    const post = (b: string | object | undefined, type = "application/json") =>
      request(w.app)
        .post(api("/register"))
        .set("X-Forwarded-For", w.person())
        .set("Content-Type", type)
        .send(b as never);
    expect((await post("{not json")).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect((await post("email=a&password=b", "application/x-www-form-urlencoded")).status).toBe(
      400,
    );
    expect(w.store.users.size).toBe(0);
  });

  it("ignores extra fields, so a request cannot set premium or anything else", async () => {
    const w = build();
    await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send({
        ...SAM,
        premiumUntil: "2999-01-01",
        disabledAt: null,
        sessionVersion: 99,
        id: "mine",
      });
    const user = [...w.store.users.values()][0]!;
    expect(user.premiumUntil).toBeNull();
    expect(user.sessionVersion).toBe(1);
    expect(user.id).not.toBe("mine");
  });

  it("refuses an email that is taken, whatever its capitals or spaces", async () => {
    const { w } = await registered();
    const res = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send({ ...SAM, email: "  SAM@Example.COM ", name: "Other" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("duplicate_email");
    expect(w.store.users.size).toBe(1);
  });

  it("limits sign-ups from one connection to five an hour", async () => {
    const w = build();
    const address = w.person();
    for (let i = 0; i < 5; i++) {
      const ok = await request(w.app)
        .post(api("/register"))
        .set("X-Forwarded-For", address)
        .send({ ...SAM, email: `p${i}@example.com` });
      expect(ok.status).toBe(200);
    }
    const sixth = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", address)
      .send({ ...SAM, email: "p6@example.com" });
    expect(sixth.status).toBe(429);
  });

  it("refuses a person who has been banned, and creates nothing", async () => {
    const w = build();
    const address = w.person();
    await w.bans.add(`visitor:${address}`, 24, "age");
    const res = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", address)
      .send(SAM);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("banned");
    expect(w.store.users.size).toBe(0);
  });
});

describe("signing in", () => {
  it("works with the right password, in any capitals, and sets the cookie", async () => {
    const { w } = await registered();
    const res = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: " SAM@example.com", password: "correct horse" });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Sam");
    expect(setCookie(res)).toMatch(/^pb_sess=.+HttpOnly/);
  });

  it("gives a wrong password and an unknown email the same answer", async () => {
    const { w } = await registered();
    const wrong = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email, password: "nope" });
    const unknown = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: "who@example.com", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(wrong.body.error.message).toBe("Wrong email or password.");
    expect(setCookie(wrong)).toBe("");
  });

  it("refuses a suspended account, and ends a cookie it already had", async () => {
    const { w, cookie } = await registered();
    w.store.suspend([...w.store.users.values()][0]!.id);
    const me = await request(w.app).get(api("/me")).set("Cookie", cookie);
    expect(me.body.user).toBeNull(); // the old cookie stopped working at once
    const res = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email, password: SAM.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("suspended");
  });

  it("locks a guesser out after ten failures, even for the right password", async () => {
    const { w } = await registered();
    const address = w.person();
    for (let i = 0; i < 10; i++) {
      await request(w.app)
        .post(api("/login"))
        .set("X-Forwarded-For", address)
        .send({ email: `x${i}@example.com`, password: "nope" });
    }
    const res = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", address)
      .send({ email: SAM.email, password: SAM.password });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("too_many");
  });

  it("refuses a missing password or garbage body with a 400", async () => {
    const { w } = await registered();
    const res = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email });
    expect(res.status).toBe(400);
  });
});

describe("signing out", () => {
  it("clears the cookie, and the account is no longer recognised without it", async () => {
    const { w, cookie } = await registered();
    const out = await request(w.app).post(api("/logout")).set("Cookie", cookie);
    expect(out.status).toBe(200);
    expect(setCookie(out)).toMatch(/^pb_sess=;/);
    expect(setCookie(out)).toMatch(/Expires=Thu, 01 Jan 1970/);
    const me = await request(w.app).get(api("/me")); // the browser has dropped the cookie
    expect(me.body.user).toBeNull();
  });

  it("works even when nobody is signed in", async () => {
    const { app } = build();
    expect((await request(app).post(api("/logout"))).status).toBe(200);
  });
});

describe("changing the password", () => {
  it("needs a sign-in", async () => {
    const { app } = build();
    const res = await request(app)
      .post(api("/password"))
      .send({ password: "x", next: "brand new pass" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("not_signed_in");
  });

  it("refuses a wrong current password and a weak new one", async () => {
    const { w, cookie } = await registered();
    const wrong = await request(w.app)
      .post(api("/password"))
      .set("Cookie", cookie)
      .send({ password: "nope", next: "brand new pass" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe("That password isn't right.");
    const weak = await request(w.app)
      .post(api("/password"))
      .set("Cookie", cookie)
      .send({ password: SAM.password, next: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.message).toBe("Use a new password of 8 to 128 characters.");
  });

  it("switches the password, keeps this browser signed in, and signs every other browser out", async () => {
    const { w, cookie: here } = await registered();
    const other = cookieOf(
      await request(w.app)
        .post(api("/login"))
        .set("X-Forwarded-For", w.person())
        .send({ email: SAM.email, password: SAM.password }),
    );
    expect((await request(w.app).get(api("/me")).set("Cookie", other)).body.user).not.toBeNull();

    const res = await request(w.app)
      .post(api("/password"))
      .set("Cookie", here)
      .send({ password: SAM.password, next: "brand new pass" });
    expect(res.status).toBe(200);
    const fresh = cookieOf(res);
    expect(fresh).not.toBe("");

    expect((await request(w.app).get(api("/me")).set("Cookie", fresh)).body.user).not.toBeNull(); // this browser carries on
    expect((await request(w.app).get(api("/me")).set("Cookie", here)).body.user).toBeNull(); // the old cookie is dead
    expect((await request(w.app).get(api("/me")).set("Cookie", other)).body.user).toBeNull(); // so is the other browser's

    const oldPw = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email, password: SAM.password });
    expect(oldPw.status).toBe(401);
    const newPw = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email, password: "brand new pass" });
    expect(newPw.status).toBe(200);
  });
});

describe("deleting an account", () => {
  it("needs a sign-in and the right password", async () => {
    const { w, cookie } = await registered();
    expect(
      (await request(w.app).post(api("/delete")).send({ password: SAM.password })).status,
    ).toBe(401);
    const wrong = await request(w.app)
      .post(api("/delete"))
      .set("Cookie", cookie)
      .send({ password: "nope" });
    expect(wrong.status).toBe(401);
    expect(w.store.users.size).toBe(1);
  });

  it("removes the account for good, clears the cookie, and the old cookie stops working", async () => {
    const { w, cookie } = await registered();
    const res = await request(w.app)
      .post(api("/delete"))
      .set("Cookie", cookie)
      .send({ password: SAM.password });
    expect(res.status).toBe(200);
    expect(setCookie(res)).toMatch(/^pb_sess=;/);
    expect(w.store.users.size).toBe(0);
    expect((await request(w.app).get(api("/me")).set("Cookie", cookie)).body.user).toBeNull();
    const again = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: SAM.email, password: SAM.password });
    expect(again.status).toBe(401);
  });
});

describe("downloading my data", () => {
  it("needs a sign-in", async () => {
    expect((await request(build().app).get(api("/export"))).status).toBe(401);
  });

  it("downloads a file with the account's details and no password hash", async () => {
    const { w, cookie } = await registered();
    const res = await request(w.app).get(api("/export")).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="my-data.json"');
    expect(res.headers["content-type"]).toMatch(/json/);
    const body = JSON.parse(res.text);
    expect(body.account).toMatchObject({ email: "sam@example.com", displayName: "Sam" });
    expect(res.text).not.toContain("fake$");
    expect(res.text).not.toContain("passwordHash");
  });
});

describe("requests from other websites", () => {
  const evil = { Origin: "https://evil.example" };

  it("are refused for every change, even with a valid cookie", async () => {
    const { w, cookie } = await registered();
    for (const [path, body] of [
      ["/register", { ...SAM, email: "x@example.com" }],
      ["/login", { email: SAM.email, password: SAM.password }],
      ["/logout", {}],
      ["/password", { password: SAM.password, next: "brand new pass" }],
      ["/delete", { password: SAM.password }],
    ] as const) {
      const res = await request(w.app).post(api(path)).set("Cookie", cookie).set(evil).send(body);
      expect(res.status, path).toBe(403);
      expect(res.body.error.code).toBe("bad_origin");
    }
    expect(w.store.users.size).toBe(1); // nothing was created or deleted
    expect((await request(w.app).get(api("/me")).set("Cookie", cookie)).body.user).not.toBeNull(); // still signed in
  });

  it("are refused when the origin can't be read", async () => {
    const { w } = await registered();
    const res = await request(w.app).post(api("/logout")).set("Origin", "not a url");
    expect(res.status).toBe(403);
  });

  it("are accepted from the site itself, from the configured address, and from non-browsers", async () => {
    const w = build();
    for (const origin of [PUBLIC_URL, undefined]) {
      const req = request(w.app).post(api("/logout"));
      if (origin) req.set("Origin", origin);
      expect((await req).status).toBe(200);
    }
    const sameHost = await request(w.app)
      .post(api("/logout"))
      .set("Host", "example.org")
      .set("Origin", "http://example.org");
    expect(sameHost.status).toBe(200);
  });
});
