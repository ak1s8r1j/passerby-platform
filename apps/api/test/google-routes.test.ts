import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { GoogleOAuth } from "../src/auth/google.js";
import { OAUTH_COOKIE, sealState } from "../src/auth/oauth-state.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { accountsWorld, SAM } from "./auth-helpers.js";
import { MemoryBans } from "./chat-helpers.js";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  FakeGoogle,
  REDIRECT_URI,
  type Person,
  type Tamper,
} from "./fake-google.js";
import { silent, testConfig } from "./helpers.js";

const SECRET = "google-route-secret-123456";
type Res = request.Response;

let google: FakeGoogle;
beforeAll(async () => {
  google = await new FakeGoogle().start();
});
afterAll(async () => {
  await google.stop();
});
afterEach(() => vi.useRealTimers());

const RILEY: Person = { sub: "g-riley", email: "riley@example.com", name: "Riley Q" };

function build(opts: { withGoogle?: boolean } = {}) {
  const w = accountsWorld();
  const bans = new MemoryBans();
  const problems: string[] = [];
  const oauth = new GoogleOAuth({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    endpoints: google.endpoints,
  });
  const router = createAuthRouter({
    accounts: w.accounts,
    store: w.store,
    bans,
    secret: SECRET,
    visitorOf: (ip) => `visitor:${ip}`,
    publicUrl: "http://localhost:5173",
    google: opts.withGoogle === false ? undefined : oauth,
    onProblem: (_err, what) => problems.push(what),
  });
  const app = createApp({
    config: testConfig({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET }),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
    auth: router,
  });
  let n = 0;
  const person = () => `10.7.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
  return { ...w, bans, app, problems, person };
}
type World = ReturnType<typeof build>;

const api = (path: string) => `/api/v1/auth${path}`;
const setCookies = (res: Res) =>
  (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
/** What a browser's cookies look like after this response: new ones added, cleared ones removed. */
const apply = (jar: Record<string, string>, res: Res) => {
  const out: Record<string, string> = { ...jar };
  for (const c of setCookies(res)) {
    const [pair] = c.split(";") as [string];
    const i = pair.indexOf("=");
    const name = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value) out[name] = value;
    else delete out[name];
  }
  return out;
};
/** Just the cookies this one response keeps. */
const kept = (res: Res) => apply({}, res);
const cookieHeader = (...jars: Record<string, string>[]) =>
  Object.entries(Object.assign({}, ...jars))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

interface Trip {
  /** Response to /google/start. */
  start: Res;
  /** The cookies the browser holds on the way to Google and back. */
  jar: Record<string, string>;
  /** What Google was asked for. */
  asked: ReturnType<typeof FakeGoogle.requestFrom>;
}

async function begin(
  w: World,
  address: string,
  query = "",
  session: Record<string, string> = {},
): Promise<Trip> {
  const start = await request(w.app)
    .get(api(`/google/start${query}`))
    .set("X-Forwarded-For", address)
    .set("Cookie", cookieHeader(session));
  const where = start.headers.location ?? "";
  return {
    start,
    jar: apply(session, start),
    asked: where.startsWith("http") ? FakeGoogle.requestFrom(where) : ({} as Trip["asked"]),
  };
}

/** Google sends the visitor back with a code for `person`. */
async function comeBack(
  w: World,
  trip: Trip,
  address: string,
  person: Person,
  tamper: Tamper = {},
  over: { state?: string; jar?: Record<string, string> } = {},
) {
  const code = google.issueCode(
    person,
    { nonce: trip.asked.nonce, challenge: trip.asked.challenge },
    tamper,
  );
  const q = new URLSearchParams({ code, state: over.state ?? trip.asked.state });
  return request(w.app)
    .get(api(`/google/callback?${q}`))
    .set("X-Forwarded-For", address)
    .set("Cookie", cookieHeader(over.jar ?? trip.jar));
}

/** The whole trip: start, log in at Google, come back. */
async function signInWithGoogle(
  w: World,
  person: Person = RILEY,
  query = "?adult=1",
  session: Record<string, string> = {},
) {
  const address = w.person();
  const trip = await begin(w, address, query, session);
  const back = await comeBack(w, trip, address, person);
  return { address, trip, back, jar: apply(trip.jar, back) };
}

const result = (res: Res) => res.headers.location;

describe("when Google sign-in is not set up", () => {
  it("answers not found everywhere, and the account page is told it is off", async () => {
    const w = build({ withGoogle: false });
    for (const [method, path] of [
      ["get", "/google/start"],
      ["get", "/google/callback"],
    ] as const) {
      const res = await request(w.app)[method](api(path));
      expect(res.status, path).toBe(404);
    }
    expect((await request(w.app).get(api("/google/start"))).body.error.code).toBe("not_found");
  });

  it("still lets someone disconnect Google they connected earlier (it asks them to sign in first)", async () => {
    const w = build({ withGoogle: false });
    expect((await request(w.app).post(api("/google/unlink"))).status).toBe(401);
  });
});

describe("sending the visitor to Google", () => {
  it("redirects to Google's login with a one-time state, nonce and PKCE challenge", async () => {
    const w = build();
    const { start, asked } = await begin(w, w.person());
    expect(start.status).toBe(302);
    expect(start.headers.location).toMatch(new RegExp(`^${google.base}/auth\\?`));
    expect(asked.state.length).toBeGreaterThan(16);
    expect(asked.nonce.length).toBeGreaterThan(16);
    expect(asked.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(asked.redirectUri).toBe(REDIRECT_URI);
    expect(start.headers.location).not.toContain(CLIENT_SECRET);
  });

  it("uses fresh values every time", async () => {
    const w = build();
    const a = await begin(w, w.person());
    const b = await begin(w, w.person());
    expect(
      new Set([
        a.asked.state,
        b.asked.state,
        a.asked.nonce,
        b.asked.nonce,
        a.asked.challenge,
        b.asked.challenge,
      ]).size,
    ).toBe(6);
  });

  it("remembers the trip in a short-lived cookie that scripts can't read and other pages can't use", async () => {
    const w = build();
    const { start } = await begin(w, w.person());
    const header = setCookies(start).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/api/v1/auth/google");
    expect(header).toContain("Max-Age=600");
    expect(header).not.toContain("Secure"); // plain http in this test
    const https = await request(w.app)
      .get(api("/google/start"))
      .set("X-Forwarded-For", w.person())
      .set("X-Forwarded-Proto", "https");
    expect(setCookies(https).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))).toContain("Secure");
  });

  it("is never cached", async () => {
    const w = build();
    expect((await begin(w, w.person())).start.headers["cache-control"]).toBe("no-store");
  });

  it("limits how often one connection can start", async () => {
    const w = build();
    const address = w.person();
    for (let i = 0; i < 20; i++) expect((await begin(w, address)).start.status).toBe(302);
    const extra = await begin(w, address);
    expect(extra.start.status).toBe(429);
    expect(extra.start.body.error.code).toBe("too_many");
  });
});

describe("a new person signing in with Google", () => {
  it("gets an account with no password, is signed in, and lands on the account page", async () => {
    const w = build();
    const { back, jar } = await signInWithGoogle(w);
    expect(back.status).toBe(302);
    expect(result(back)).toBe("/account?google=created");
    expect(jar.pb_sess).toBeTruthy();
    const me = await request(w.app).get(api("/me")).set("Cookie", cookieHeader(jar));
    expect(me.body.user).toMatchObject({
      name: "Riley Q",
      email: "riley@example.com",
      hasPassword: false,
      google: true,
    });
    const stored = [...w.store.users.values()][0]!;
    expect(stored.passwordHash).toBeNull();
    expect(stored.googleSub).toBe("g-riley");
  });

  it("uses a cookie that is HttpOnly and SameSite=Lax, just like a password sign-in", async () => {
    const w = build();
    const { back } = await signInWithGoogle(w);
    const header = setCookies(back).find((c) => c.startsWith("pb_sess="))!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("uses the trip cookie once: it is cleared on the way back", async () => {
    const w = build();
    const { back, jar } = await signInWithGoogle(w);
    expect(jar[OAUTH_COOKIE]).toBeUndefined();
    expect(setCookies(back).find((c) => c.startsWith(`${OAUTH_COOKIE}=;`))).toMatch(
      /Expires=Thu, 01 Jan 1970/,
    );
  });

  it("is turned away, with the reason, if they have not ticked the 18+ box, and nothing is created", async () => {
    const w = build();
    const { back, jar } = await signInWithGoogle(w, RILEY, "");
    expect(result(back)).toBe("/account?google=adult_required");
    expect(jar.pb_sess).toBeUndefined();
    expect(w.store.users.size).toBe(0);
  });

  it("is turned away if their address is banned", async () => {
    const w = build();
    const address = w.person();
    await w.bans.add(`visitor:${address}`, 24, "age");
    const trip = await begin(w, address, "?adult=1");
    const back = await comeBack(w, trip, address, RILEY);
    expect(result(back)).toBe("/account?google=banned");
    expect(w.store.users.size).toBe(0);
  });

  it("is turned away if Google says the email isn't verified", async () => {
    const w = build();
    const { back } = await signInWithGoogle(w, { ...RILEY, email_verified: false });
    expect(result(back)).toBe("/account?google=google_unverified");
    expect(w.store.users.size).toBe(0);
  });

  it("makes a safe display name even from a hostile Google name", async () => {
    const w = build();
    await signInWithGoogle(w, { ...RILEY, name: "<script>alert(1)</script>" });
    expect([...w.store.users.values()][0]!.displayName).toBe("scriptalert1script");
  });
});

describe("someone who has used Google before", () => {
  it("is signed in again without the age box, and it counts as a sign-in", async () => {
    const w = build();
    await signInWithGoogle(w);
    const { back, jar } = await signInWithGoogle(w, RILEY, "");
    expect(result(back)).toBe("/account?google=ok");
    expect(jar.pb_sess).toBeTruthy();
    expect(w.store.users.size).toBe(1);
    expect([...w.store.users.values()][0]!.loginCount).toBe(1);
  });

  it("is refused if the account has been suspended, and gets no cookie", async () => {
    const w = build();
    await signInWithGoogle(w);
    w.store.suspend([...w.store.users.values()][0]!.id);
    const { back, jar } = await signInWithGoogle(w, RILEY, "");
    expect(result(back)).toBe("/account?google=suspended");
    expect(jar.pb_sess).toBeUndefined();
  });
});

describe("an email that already has an account", () => {
  it("is not taken over by Google: the account page is told 'email_in_use' and nothing changes", async () => {
    const w = build();
    await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send({
        ...SAM,
        email: "riley@example.com",
        name: "Attacker",
        password: "attacker knows this",
      });
    const { back, jar } = await signInWithGoogle(w);
    expect(result(back)).toBe("/account?google=email_in_use");
    expect(jar.pb_sess).toBeUndefined();
    expect(w.store.users.size).toBe(1);
    expect([...w.store.users.values()][0]!.googleSub).toBeNull();
  });
});

describe("a return trip that was not started by this browser, or that went wrong", () => {
  it("shows the plain 'didn't work' message, and logs it, when our own database fails mid-trip", async () => {
    const w = build();
    vi.spyOn(w.store, "findByGoogleSub").mockRejectedValue(new Error("column does not exist"));
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const back = await comeBack(w, trip, address, RILEY);
    expect(back.status).toBe(302);
    expect(result(back)).toBe("/account?google=failed");
    expect(w.problems.join("\n")).toContain("column does not exist");
    expect(setCookies(back).some((c) => c.startsWith("pb_sess="))).toBe(false); // nobody signed in
  });

  it("is refused if the state does not match, even with a valid code", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const back = await comeBack(w, trip, address, RILEY, {}, { state: "a-different-state" });
    expect(result(back)).toBe("/account?google=expired");
    expect(w.store.users.size).toBe(0);
  });

  it("is refused if there is no trip cookie (someone else's code, sent to this browser)", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const back = await comeBack(w, trip, address, RILEY, {}, { jar: {} });
    expect(result(back)).toBe("/account?google=expired");
    expect(w.store.users.size).toBe(0);
  });

  it("is refused if the trip cookie was made with another secret, or edited", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const forged = sealState("some-other-secret-entirely-123", {
      state: trip.asked.state,
      nonce: trip.asked.nonce,
      verifier: "v",
      adult: true,
      link: "",
      exp: Date.now() + 60_000,
    });
    expect(
      result(await comeBack(w, trip, address, RILEY, {}, { jar: { [OAUTH_COOKIE]: forged } })),
    ).toBe("/account?google=expired");
    const edited = trip.jar[OAUTH_COOKIE]!.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect(
      result(await comeBack(w, trip, address, RILEY, {}, { jar: { [OAUTH_COOKIE]: edited } })),
    ).toBe("/account?google=expired");
    expect(w.store.users.size).toBe(0);
  });

  it("is refused if the visitor took more than ten minutes at Google", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    const back = await comeBack(w, trip, address, RILEY);
    expect(result(back)).toBe("/account?google=expired");
    expect(w.store.users.size).toBe(0);
  });

  it("cannot be replayed: the code works once", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const code = google.issueCode(RILEY, {
      nonce: trip.asked.nonce,
      challenge: trip.asked.challenge,
    });
    const url = api(`/google/callback?code=${code}&state=${trip.asked.state}`);
    const first = await request(w.app)
      .get(url)
      .set("X-Forwarded-For", address)
      .set("Cookie", cookieHeader(trip.jar));
    expect(result(first)).toBe("/account?google=created");
    const replay = await request(w.app)
      .get(url)
      .set("X-Forwarded-For", address)
      .set("Cookie", cookieHeader(trip.jar));
    expect(result(replay)).toBe("/account?google=failed");
    expect(kept(replay).pb_sess).toBeUndefined();
  });

  it("reports a cancelled login as cancelled, and anything else Google says as failed", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const cancelled = await request(w.app)
      .get(api("/google/callback?error=access_denied"))
      .set("X-Forwarded-For", address)
      .set("Cookie", cookieHeader(trip.jar));
    expect(result(cancelled)).toBe("/account?google=cancelled");
    const other = await request(w.app)
      .get(api("/google/callback?error=server_error"))
      .set("X-Forwarded-For", address)
      .set("Cookie", cookieHeader(trip.jar));
    expect(result(other)).toBe("/account?google=failed");
    expect(w.store.users.size).toBe(0);
  });

  it("fails cleanly when no code comes back", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const back = await request(w.app)
      .get(api(`/google/callback?state=${trip.asked.state}`))
      .set("X-Forwarded-For", address)
      .set("Cookie", cookieHeader(trip.jar));
    expect(result(back)).toBe("/account?google=failed");
  });

  it.each<[string, Tamper]>([
    ["made for a different request", { nonce: "another-nonce" }],
    ["made for another website", { aud: "another-client" }],
    ["from a fake Google", { iss: "https://evil.example" }],
    ["expired", { expiresIn: -300 }],
    ["signed with the wrong key", { wrongKey: true }],
    ["unsigned", { alg: "none" }],
  ])("refuses a login token %s, creates nothing, and logs the reason", async (_name, tamper) => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    const back = await comeBack(w, trip, address, RILEY, tamper);
    expect(result(back)).toBe("/account?google=failed");
    expect(kept(back).pb_sess).toBeUndefined();
    expect(w.store.users.size).toBe(0);
    expect(w.problems.join(" ")).toMatch(/invalid_token/);
  });

  it("fails cleanly if Google itself is down", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    google.tokenFailure = { status: 503, body: "down" };
    try {
      expect(result(await comeBack(w, trip, address, RILEY))).toBe("/account?google=failed");
    } finally {
      google.tokenFailure = null;
    }
    expect(w.store.users.size).toBe(0);
  });

  it("never lets an address from the request into the redirect", async () => {
    const w = build();
    const address = w.person();
    const trip = await begin(w, address, "?adult=1");
    for (const q of [
      "error=https://evil.example/steal",
      "state=https://evil.example&code=x",
      "code=//evil.example",
      "error=%0d%0aLocation:%20https://evil.example",
    ]) {
      const res = await request(w.app)
        .get(api(`/google/callback?${q}`))
        .set("X-Forwarded-For", address)
        .set("Cookie", cookieHeader(trip.jar));
      expect(res.headers.location, q).toMatch(/^\/account\?google=[a-z_]+$/);
    }
  });

  it("keeps every redirect on this site, whatever happens", async () => {
    const w = build();
    const outcomes = [
      (await signInWithGoogle(w)).back,
      (await signInWithGoogle(w, { ...RILEY, sub: "x", email_verified: false })).back,
      (await signInWithGoogle(w, RILEY, "")).back,
    ];
    for (const res of outcomes) expect(res.headers.location).toMatch(/^\/account\?google=[a-z_]+$/);
  });
});

describe("connecting Google to an account you are signed in to", () => {
  async function signedIn(w: World) {
    const reg = await request(w.app)
      .post(api("/register"))
      .set("X-Forwarded-For", w.person())
      .send(SAM);
    return kept(reg);
  }

  it("needs a sign-in first", async () => {
    const w = build();
    const { start } = await begin(w, w.person(), "?link=1");
    expect(start.status).toBe(302);
    expect(result(start)).toBe("/account?google=not_signed_in");
    expect(setCookies(start).find((c) => c.startsWith(`${OAUTH_COOKIE}=`))).toBeUndefined();
  });

  it("joins Google to the account, and then Google signs in to it", async () => {
    const w = build();
    const session = await signedIn(w);
    const { back } = await signInWithGoogle(w, RILEY, "?link=1", session);
    expect(result(back)).toBe("/account?google=linked");
    const user = [...w.store.users.values()][0]!;
    expect(user.googleSub).toBe("g-riley");
    expect(user.email).toBe("sam@example.com"); // the email stays the account's own
    const me = await request(w.app).get(api("/me")).set("Cookie", cookieHeader(session));
    expect(me.body.user).toMatchObject({ hasPassword: true, google: true });
    // a fresh browser with only Google now arrives in the same account
    const again = await signInWithGoogle(w, RILEY, "");
    expect(result(again.back)).toBe("/account?google=ok");
    expect(w.store.users.size).toBe(1);
  });

  it("is refused if someone else is signed in when the trip ends", async () => {
    const w = build();
    const sam = await signedIn(w);
    const address = w.person();
    const trip = await begin(w, address, "?link=1", sam);
    const other = kept(
      await request(w.app)
        .post(api("/register"))
        .set("X-Forwarded-For", w.person())
        .send({ ...SAM, email: "other@example.com", name: "Other" }),
    );
    const back = await comeBack(
      w,
      trip,
      address,
      RILEY,
      {},
      { jar: { [OAUTH_COOKIE]: trip.jar[OAUTH_COOKIE]!, ...other } },
    );
    expect(result(back)).toBe("/account?google=expired");
    expect([...w.store.users.values()].every((u) => u.googleSub === null)).toBe(true);
  });

  it("is refused if they signed out in between", async () => {
    const w = build();
    const sam = await signedIn(w);
    const address = w.person();
    const trip = await begin(w, address, "?link=1", sam);
    const back = await comeBack(
      w,
      trip,
      address,
      RILEY,
      {},
      { jar: { [OAUTH_COOKIE]: trip.jar[OAUTH_COOKIE]! } },
    );
    expect(result(back)).toBe("/account?google=expired");
  });

  it("is refused if that Google account belongs to a different account here", async () => {
    const w = build();
    await signInWithGoogle(w); // Riley's Google account has its own account
    const session = await signedIn(w);
    const { back } = await signInWithGoogle(w, RILEY, "?link=1", session);
    expect(result(back)).toBe("/account?google=google_in_use");
  });
});

describe("disconnecting Google", () => {
  it("needs a sign-in, refuses to leave someone with no way in, and otherwise works", async () => {
    const w = build();
    expect((await request(w.app).post(api("/google/unlink"))).status).toBe(401);

    const { jar } = await signInWithGoogle(w); // Google only: no password
    const refused = await request(w.app)
      .post(api("/google/unlink"))
      .set("Cookie", cookieHeader(jar));
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("no_password");

    const set = await request(w.app)
      .post(api("/password"))
      .set("Cookie", cookieHeader(jar))
      .send({ next: "brand new pass" });
    expect(set.status).toBe(200);
    const session = { ...jar, ...kept(set) };
    const ok = await request(w.app)
      .post(api("/google/unlink"))
      .set("Cookie", cookieHeader(session));
    expect(ok.status).toBe(200);
    const me = await request(w.app).get(api("/me")).set("Cookie", cookieHeader(session));
    expect(me.body.user).toMatchObject({ hasPassword: true, google: false });
  });

  it("refuses a request made from another website", async () => {
    const w = build();
    const { jar } = await signInWithGoogle(w);
    const res = await request(w.app)
      .post(api("/google/unlink"))
      .set("Cookie", cookieHeader(jar))
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });
});

describe("a Google-only account's own settings", () => {
  it("can set a first password without giving one, which ends other browsers' sign-ins", async () => {
    const w = build();
    const { jar } = await signInWithGoogle(w);
    const otherBrowser = (await signInWithGoogle(w, RILEY, "")).jar;
    const set = await request(w.app)
      .post(api("/password"))
      .set("Cookie", cookieHeader(jar))
      .send({ next: "brand new pass" });
    expect(set.status).toBe(200);
    expect(
      (await request(w.app).get(api("/me")).set("Cookie", cookieHeader(otherBrowser))).body.user,
    ).toBeNull();
    const login = await request(w.app)
      .post(api("/login"))
      .set("X-Forwarded-For", w.person())
      .send({ email: "riley@example.com", password: "brand new pass" });
    expect(login.status).toBe(200);
  });

  it("deletes the account by typing the email address, not a password", async () => {
    const w = build();
    const { jar } = await signInWithGoogle(w);
    const wrong = await request(w.app)
      .post(api("/delete"))
      .set("Cookie", cookieHeader(jar))
      .send({ email: "someone@else.com" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("wrong_confirmation");
    const noPassword = await request(w.app)
      .post(api("/delete"))
      .set("Cookie", cookieHeader(jar))
      .send({ password: "" });
    expect(noPassword.status).toBe(400);
    expect(w.store.users.size).toBe(1);
    const ok = await request(w.app)
      .post(api("/delete"))
      .set("Cookie", cookieHeader(jar))
      .send({ email: "riley@example.com" });
    expect(ok.status).toBe(200);
    expect(w.store.users.size).toBe(0);
  });

  it("downloads data that says there is no password and Google is connected", async () => {
    const w = build();
    const { jar } = await signInWithGoogle(w);
    const res = await request(w.app).get(api("/export")).set("Cookie", cookieHeader(jar));
    expect(JSON.parse(res.text).account).toMatchObject({
      hasPassword: false,
      googleConnected: true,
    });
    expect(res.text).not.toContain("g-riley");
  });
});
