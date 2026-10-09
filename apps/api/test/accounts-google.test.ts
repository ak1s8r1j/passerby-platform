import { describe, expect, it } from "vitest";
import type { GoogleProfile } from "../src/auth/google.js";
import { AuthError, nameFromGoogle } from "../src/auth/service.js";
import { accountsWorld, SAM, type FakeHasher } from "./auth-helpers.js";

async function failure(p: Promise<unknown>): Promise<AuthError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected it to fail, but it worked");
}

const RILEY: GoogleProfile = {
  sub: "g-1001",
  email: "riley@example.com",
  emailVerified: true,
  name: "Riley Q",
};
const ctx = (over: Partial<{ visitor: string; adult: boolean; banned: boolean }> = {}) => ({
  visitor: "visitor-1",
  adult: true,
  banned: false,
  ...over,
});

describe("making a name from what Google says", () => {
  it.each([
    ["Riley Q", "riley@example.com", "Riley Q"],
    ["  Zoë   Müller ", "z@example.com", "Zoë Müller"],
    ["音楽家", "x@example.com", "音楽家"],
    ["Sam 😀 <b>", "sam@example.com", "Sam b"],
    ["", "alex.smith@example.com", "alex.smith"],
    ["   ", "alex_smith@example.com", "alex_smith"],
    ["x".repeat(60), "a@example.com", "x".repeat(24)],
    ["‮Sam​", "sam@example.com", "Sam"],
    ["!!!", "ok.name@example.com", "ok.name"],
  ])("turns %j (%s) into %j", (name, email, expected) => {
    expect(nameFromGoogle(name, email)).toBe(expected);
  });

  it("falls back to a plain name when nothing usable is left", () => {
    expect(nameFromGoogle("", "a@example.com")).toBe("Google user");
    expect(nameFromGoogle("!", "!@example.com")).toBe("Google user");
    expect(nameFromGoogle("😀😀", "1@example.com")).toBe("Google user");
  });

  it("never produces a name the sign-up form would refuse", () => {
    for (const [name, email] of [
      ["a", "b@c.co"],
      ["<script>alert(1)</script>", "q@c.co"],
      ["x".repeat(500), "q@c.co"],
    ] as const) {
      const made = nameFromGoogle(name, email);
      expect(made.length).toBeGreaterThanOrEqual(2);
      expect(made.length).toBeLessThanOrEqual(24);
      expect(made).toMatch(/^[\p{L}\p{N} ._-]+$/u);
    }
  });
});

describe("signing in with Google for the first time", () => {
  it("makes an account with no password, linked to the Google account", async () => {
    const w = accountsWorld();
    const { user, created } = await w.accounts.googleSignIn(RILEY, ctx());
    expect(created).toBe(true);
    expect(user).toMatchObject({
      email: "riley@example.com",
      displayName: "Riley Q",
      googleSub: "g-1001",
      passwordHash: null,
      sessionVersion: 1,
      signupRef: "visitor-1",
    });
    expect(w.accounts.publicUser(user)).toMatchObject({ hasPassword: false, google: true });
  });

  it("uses the lower-case email, however Google spells it", async () => {
    const w = accountsWorld();
    const { user } = await w.accounts.googleSignIn({ ...RILEY, email: "Riley@Example.COM" }, ctx());
    expect(user.email).toBe("riley@example.com");
  });

  it("logs it without the email or the Google id", async () => {
    const w = accountsWorld();
    await w.accounts.googleSignIn(RILEY, ctx());
    expect(w.events.types()).toEqual(["google_register"]);
    const text = JSON.stringify(w.events.events);
    expect(text).not.toContain("riley@example.com");
    expect(text).not.toContain("g-1001");
  });

  it("needs the 18+ confirmation, like an ordinary sign-up, and creates nothing without it", async () => {
    const w = accountsWorld();
    const err = await failure(w.accounts.googleSignIn(RILEY, ctx({ adult: false })));
    expect(err.code).toBe("adult_required");
    expect(err.message).toMatch(/18\+ box/);
    expect(w.store.users.size).toBe(0);
  });

  it("is refused for someone who has been banned", async () => {
    const w = accountsWorld();
    expect((await failure(w.accounts.googleSignIn(RILEY, ctx({ banned: true })))).code).toBe(
      "banned",
    );
    expect(w.store.users.size).toBe(0);
  });

  it("is refused when Google has not verified the email address", async () => {
    const w = accountsWorld();
    const err = await failure(w.accounts.googleSignIn({ ...RILEY, emailVerified: false }, ctx()));
    expect(err.code).toBe("google_unverified");
    expect(w.store.users.size).toBe(0);
  });

  it("is refused when the email is not one we can use", async () => {
    const w = accountsWorld();
    expect(
      (await failure(w.accounts.googleSignIn({ ...RILEY, email: "not-an-email" }, ctx()))).code,
    ).toBe("google_unverified");
    expect(w.store.users.size).toBe(0);
  });

  it("counts towards the five new accounts an hour from one connection", async () => {
    const w = accountsWorld();
    for (let i = 0; i < 5; i++) {
      await w.accounts.googleSignIn({ ...RILEY, sub: `g-${i}`, email: `p${i}@example.com` }, ctx());
    }
    const err = await failure(
      w.accounts.googleSignIn({ ...RILEY, sub: "g-9", email: "p9@example.com" }, ctx()),
    );
    expect(err.code).toBe("too_many");
    // but someone who already has an account can always come back
    await w.accounts.googleSignIn({ ...RILEY, sub: "g-0", email: "p0@example.com" }, ctx());
  });

  it("lets only one of two simultaneous sign-ins create the account, and signs both in to it", async () => {
    const w = accountsWorld();
    const [a, b] = await Promise.all([
      w.accounts.googleSignIn(RILEY, ctx({ visitor: "v1" })),
      w.accounts.googleSignIn(RILEY, ctx({ visitor: "v2" })),
    ]);
    expect(w.store.users.size).toBe(1);
    expect(a.user.id).toBe(b.user.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });
});

describe("coming back with Google", () => {
  async function returning() {
    const w = accountsWorld();
    await w.accounts.googleSignIn(RILEY, ctx());
    w.events.events.length = 0;
    return w;
  }

  it("signs in, counts it, and does not ask for the age box again", async () => {
    const w = await returning();
    const { user, created } = await w.accounts.googleSignIn(RILEY, ctx({ adult: false }));
    expect(created).toBe(false);
    expect(user.loginCount).toBe(1);
    expect(w.events.types()).toEqual(["google_login"]);
  });

  it("recognises them by Google's id, so a changed email at Google does not make a second account", async () => {
    const w = await returning();
    const { user } = await w.accounts.googleSignIn(
      { ...RILEY, email: "riley.new@example.com" },
      ctx(),
    );
    expect(user.email).toBe("riley@example.com");
    expect(w.store.users.size).toBe(1);
  });

  it("refuses a suspended account", async () => {
    const w = await returning();
    w.store.suspend([...w.store.users.values()][0]!.id);
    expect((await failure(w.accounts.googleSignIn(RILEY, ctx()))).code).toBe("suspended");
    expect(w.events.types()).toEqual(["login_blocked"]);
  });
});

describe("an account made with a password, and then Google", () => {
  it("is NOT joined to a Google account that has the same email: that would let anyone take over an email they don't own", async () => {
    // The attack: sign-ups here don't verify email, so an attacker registers the victim's address with a password they know...
    const w = accountsWorld();
    await w.accounts.register(
      { ...SAM, email: "victim@example.com", name: "Attacker", password: "attacker knows this" },
      "attacker",
    );
    w.events.events.length = 0;

    // ...then waits for the real owner to come along and use "Continue with Google".
    const err = await failure(
      w.accounts.googleSignIn(
        { sub: "g-victim", email: "victim@example.com", emailVerified: true, name: "Victim" },
        ctx({ visitor: "victim" }),
      ),
    );
    expect(err.code).toBe("email_in_use");
    expect(err.message).toMatch(/connect Google from your account page/);

    const account = (await w.store.findByEmail("victim@example.com"))!;
    expect(account.googleSub).toBeNull(); // not joined
    expect(w.store.users.size).toBe(1); // and no second account either
    expect(w.events.types()).toEqual(["google_refused"]);
    // the attacker's password still belongs to a separate account that the victim never entered
    await w.accounts.login("victim@example.com", "attacker knows this", "attacker");
  });
});

describe("connecting Google to an account you are already signed in to", () => {
  async function signedIn() {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    w.events.events.length = 0;
    return { w, user };
  }

  it("joins them, and then Google signs in to that account", async () => {
    const { w, user } = await signedIn();
    const updated = await w.accounts.linkGoogle(user, RILEY, "v1");
    expect(updated.googleSub).toBe("g-1001");
    expect(w.events.types()).toEqual(["google_linked"]);
    const again = await w.accounts.googleSignIn(RILEY, ctx({ adult: false }));
    expect(again.user.id).toBe(user.id);
    expect(again.created).toBe(false);
  });

  it("works with a different email at Google, since you proved you own this account by being signed in", async () => {
    const { w, user } = await signedIn();
    await w.accounts.linkGoogle(user, { ...RILEY, email: "other-address@example.com" }, "v1");
    expect((await w.store.findById(user.id))!.email).toBe("sam@example.com");
  });

  it("refuses a Google account that is already connected to someone else", async () => {
    const { w, user } = await signedIn();
    await w.accounts.googleSignIn(RILEY, ctx());
    const err = await failure(w.accounts.linkGoogle(user, RILEY, "v1"));
    expect(err.code).toBe("google_in_use");
    expect((await w.store.findById(user.id))!.googleSub).toBeNull();
  });

  it("does nothing, harmlessly, if it is already connected to this account", async () => {
    const { w, user } = await signedIn();
    await w.accounts.linkGoogle(user, RILEY, "v1");
    w.events.events.length = 0;
    await w.accounts.linkGoogle((await w.store.findById(user.id))!, RILEY, "v1");
    expect(w.events.types()).toEqual([]);
  });
});

describe("disconnecting Google", () => {
  it("is allowed once there is a password", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    await w.accounts.linkGoogle(user, RILEY, "v1");
    const updated = await w.accounts.unlinkGoogle((await w.store.findById(user.id))!, "v1");
    expect(updated.googleSub).toBeNull();
    expect(w.events.types()).toContain("google_unlinked");
  });

  it("is refused if it would leave no way to sign in", async () => {
    const w = accountsWorld();
    const { user } = await w.accounts.googleSignIn(RILEY, ctx());
    const err = await failure(w.accounts.unlinkGoogle(user, "v1"));
    expect(err.code).toBe("no_password");
    expect((await w.store.findById(user.id))!.googleSub).toBe("g-1001");
  });

  it("does nothing if Google was never connected", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    expect((await w.accounts.unlinkGoogle(user, "v1")).googleSub).toBeNull();
  });
});

describe("someone with no password", () => {
  async function googleOnly() {
    const w = accountsWorld();
    const { user } = await w.accounts.googleSignIn(RILEY, ctx());
    w.events.events.length = 0;
    return { w, user };
  }

  it("cannot sign in with an email and password, and is told only 'wrong email or password'", async () => {
    const { w } = await googleOnly();
    for (const guess of ["", "password", "riley@example.com", "x".repeat(100)]) {
      const err = await failure(w.accounts.login("riley@example.com", guess, "guesser"));
      expect(err.code).toBe("bad_credentials");
      expect(err.message).toBe("Wrong email or password.");
    }
  });

  it("can never be signed in by a password check that happens to say 'yes' (the dummy-hash trap)", async () => {
    // When there is no password to check, a stand-in is checked so the timing looks the same.
    // If that stand-in ever matched, a missing password would mean "let anyone in". Prove it can't.
    const { w } = await googleOnly();
    w.hasher.verify = async () => true; // a hasher that says yes to everything
    const err = await failure(w.accounts.login("riley@example.com", "anything at all", "attacker"));
    expect(err.code).toBe("bad_credentials");
  });

  it("is not told apart from an unknown email, by the answer or by the work done", async () => {
    const { w } = await googleOnly();
    const hasher = w.hasher as FakeHasher;
    const before = hasher.verifies;
    const noPassword = await failure(w.accounts.login("riley@example.com", "x", "a"));
    const unknown = await failure(w.accounts.login("nobody@example.com", "x", "b"));
    expect(noPassword.message).toBe(unknown.message);
    expect(hasher.verifies - before).toBe(2);
  });

  it("can set a first password without giving a current one, which signs out every other browser", async () => {
    const { w, user } = await googleOnly();
    const updated = await w.accounts.changePassword(user, undefined, "brand new pass", "v1");
    expect(updated.sessionVersion).toBe(2);
    expect(w.events.types()).toEqual(["password_set"]);
    expect(await w.accounts.login("riley@example.com", "brand new pass", "v1")).toBeDefined();
    // and now disconnecting Google is allowed
    expect(
      (await w.accounts.unlinkGoogle((await w.store.findById(user.id))!, "v1")).googleSub,
    ).toBeNull();
  });

  it("is not asked for a password they do not have, to delete the account: they type their email instead", async () => {
    const { w, user } = await googleOnly();
    const wrong = await failure(
      w.accounts.deleteAccount(user, { email: "someone.else@example.com" }, "v1"),
    );
    expect(wrong.code).toBe("wrong_confirmation");
    expect(await failure(w.accounts.deleteAccount(user, {}, "v1"))).toMatchObject({
      code: "wrong_confirmation",
    });
    expect(w.store.users.size).toBe(1);
    await w.accounts.deleteAccount(user, { email: "  Riley@Example.com " }, "v1");
    expect(w.store.users.size).toBe(0);
  });

  it("can start over with Google afterwards, as a brand new account", async () => {
    const { w, user } = await googleOnly();
    await w.accounts.deleteAccount(user, { email: "riley@example.com" }, "v1");
    const again = await w.accounts.googleSignIn(RILEY, ctx());
    expect(again.created).toBe(true);
  });

  it("is shown in the downloaded data as having no password, and Google connected", async () => {
    const { w, user } = await googleOnly();
    const data = w.accounts.exportData(user);
    expect(data.account).toMatchObject({ hasPassword: false, googleConnected: true });
    expect(JSON.stringify(data)).not.toContain("g-1001");
  });
});

describe("someone WITH a password", () => {
  it("cannot change it, or delete the account, using just their email or no password", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    expect(
      (await failure(w.accounts.changePassword(user, undefined, "brand new pass", "v1"))).code,
    ).toBe("wrong_password");
    expect((await failure(w.accounts.deleteAccount(user, { email: SAM.email }, "v1"))).code).toBe(
      "wrong_password",
    );
    expect(w.store.users.size).toBe(1);
  });
});

describe("limiting Google attempts", () => {
  it("allows twenty starts or returns in fifteen minutes from one connection, then refuses", async () => {
    const w = accountsWorld();
    for (let i = 0; i < 20; i++) w.accounts.googleAttempt("v1");
    expect(() => w.accounts.googleAttempt("v1")).toThrow(AuthError);
    w.accounts.googleAttempt("someone-else");
    w.advance(900_001);
    w.accounts.googleAttempt("v1");
  });
});
