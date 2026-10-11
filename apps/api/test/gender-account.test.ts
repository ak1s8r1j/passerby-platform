import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAuthRouter } from "../src/auth/routes.js";
import { accountsWorld, SAM } from "./auth-helpers.js";
import { MemoryBans } from "./chat-helpers.js";
import { silent, testConfig } from "./helpers.js";

describe("saying how you identify when registering", () => {
  it("keeps 'm' and 'f' on the account", async () => {
    const w = accountsWorld();
    const he = await w.accounts.register({ ...SAM, email: "he@example.com", gender: "m" }, "v1");
    const she = await w.accounts.register({ ...SAM, email: "she@example.com", gender: "f" }, "v2");
    expect(he.gender).toBe("m");
    expect(she.gender).toBe("f");
  });

  it("shows it to the owner, and treats anything unexpected in the database as 'not said'", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register({ ...SAM, gender: "f" }, "v1");
    expect(w.accounts.publicUser(user).gender).toBe("f");
    user.gender = "something-odd";
    expect(w.accounts.publicUser(user).gender).toBeNull();
  });

  it("includes it in 'download my data'", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register({ ...SAM, gender: "m" }, "v1");
    expect(w.accounts.exportData(user).account.gender).toBe("m");
  });

  it("is never written to the activity log", async () => {
    const w = accountsWorld();
    await w.accounts.register({ ...SAM, gender: "f" }, "v1");
    expect(JSON.stringify(w.events.events)).not.toMatch(/"(m|f|female|male)"/i);
  });

  it("gives an account made with Google no gender until they choose one", async () => {
    const w = accountsWorld();
    const { user } = await w.accounts.googleSignIn(
      { sub: "g-1", email: "g@example.com", emailVerified: true, name: "Gee" },
      { visitor: "v1", adult: true, banned: false },
    );
    expect(user.gender).toBeNull();
  });
});

describe("changing how you identify", () => {
  it("changes it, back and forth", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register({ ...SAM, gender: "m" }, "v1");
    expect((await w.accounts.setGender(user, "f", "v1")).gender).toBe("f");
    expect((await w.accounts.setGender(user, "m", "v1")).gender).toBe("m");
  });

  it("lets someone with no answer yet (an older account, or one made with Google) choose", async () => {
    const w = accountsWorld();
    const { user } = await w.accounts.googleSignIn(
      { sub: "g-2", email: "g2@example.com", emailVerified: true, name: "Gee" },
      { visitor: "v9", adult: true, banned: false },
    );
    expect(user.gender).toBeNull();
    expect((await w.accounts.setGender(user, "f", "v9")).gender).toBe("f");
  });

  it("logs that the profile changed, but not to what", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register({ ...SAM, gender: "m" }, "visitor-xyz");
    w.events.events.length = 0;
    await w.accounts.setGender(user, "f", "visitor-xyz");
    expect(w.events.events).toHaveLength(1);
    expect(w.events.events[0]).toMatchObject({ type: "profile_updated" });
    expect(JSON.stringify(w.events.events)).not.toMatch(/female|"f"/);
  });
});

function build() {
  const w = accountsWorld();
  const router = createAuthRouter({
    accounts: w.accounts,
    store: w.store,
    bans: new MemoryBans(),
    secret: "gender-route-secret-123456",
    visitorOf: (ip) => `visitor:${ip}`,
    publicUrl: "http://localhost:5173",
  });
  const app = createApp({
    config: testConfig(),
    logger: silent,
    health: { ping: async () => true },
    online: () => 0,
    auth: router,
  });
  return { ...w, app };
}
const api = (p: string) => `/api/v1/auth${p}`;
const cookieOf = (res: request.Response) =>
  ((res.headers["set-cookie"] as unknown as string[] | undefined) ?? [])[0]?.split(";")[0] ?? "";

describe("over HTTP", () => {
  it("refuses to register without answering, or with an answer that is not one of the choices", async () => {
    const { app } = build();
    const { gender: _gender, ...without } = SAM;
    const missing = await request(app)
      .post(api("/register"))
      .set("X-Forwarded-For", "10.9.0.1")
      .send(without);
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toBe("Choose how you identify.");
    for (const gender of ["", "x", "male", "other", "none", "prefer-not-to-say", null, 1]) {
      const res = await request(app)
        .post(api("/register"))
        .set("X-Forwarded-For", "10.9.0.2")
        .send({ ...SAM, gender });
      expect(res.status, String(gender)).toBe(400);
    }
  });

  it("registers with an answer and says it back on /me", async () => {
    const { app } = build();
    const res = await request(app)
      .post(api("/register"))
      .set("X-Forwarded-For", "10.9.0.3")
      .send({ ...SAM, gender: "f" });
    expect(res.status).toBe(200);
    expect(res.body.user.gender).toBe("f");
    const me = await request(app).get(api("/me")).set("Cookie", cookieOf(res));
    expect(me.body.user.gender).toBe("f");
  });

  it("changes it from the profile route, and back", async () => {
    const { app } = build();
    const reg = await request(app)
      .post(api("/register"))
      .set("X-Forwarded-For", "10.9.0.5")
      .send(SAM);
    expect(reg.body.user.gender).toBe("m");
    const toF = await request(app)
      .post(api("/profile"))
      .set("Cookie", cookieOf(reg))
      .send({ gender: "f" });
    expect(toF.status).toBe(200);
    expect(toF.body.user.gender).toBe("f");
    const me = await request(app).get(api("/me")).set("Cookie", cookieOf(reg));
    expect(me.body.user.gender).toBe("f");
    const toM = await request(app)
      .post(api("/profile"))
      .set("Cookie", cookieOf(reg))
      .send({ gender: "m" });
    expect(toM.body.user.gender).toBe("m");
  });

  it("makes you sign in first, and rejects nonsense", async () => {
    const { app } = build();
    expect((await request(app).post(api("/profile")).send({ gender: "m" })).status).toBe(401);
    const reg = await request(app)
      .post(api("/register"))
      .set("X-Forwarded-For", "10.9.0.6")
      .send(SAM);
    for (const gender of ["", "x", "none", undefined, 5]) {
      const res = await request(app)
        .post(api("/profile"))
        .set("Cookie", cookieOf(reg))
        .send({ gender });
      expect(res.status, String(gender)).toBe(400);
    }
  });

  it("refuses a change requested from another website", async () => {
    const { app } = build();
    const reg = await request(app)
      .post(api("/register"))
      .set("X-Forwarded-For", "10.9.0.7")
      .send(SAM);
    const res = await request(app)
      .post(api("/profile"))
      .set("Cookie", cookieOf(reg))
      .set("Origin", "https://evil.example")
      .send({ gender: "f" });
    expect(res.status).toBe(403);
  });
});
