import { describe, expect, it } from "vitest";
import { AuthError } from "../src/auth/service.js";
import { accountsWorld, SAM } from "./auth-helpers.js";

/** Run something that should fail with an AuthError, and return the error. */
async function failure(p: Promise<unknown>): Promise<AuthError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AuthError) return err;
    throw err;
  }
  throw new Error("expected it to fail, but it worked");
}

describe("registering", () => {
  it("creates the account, storing a hash and never the password", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "visitor-1");
    expect(user.email).toBe("sam@example.com");
    expect(user.displayName).toBe("Sam");
    expect(user.passwordHash).toMatch(/^fake\$/);
    expect(user.passwordHash).not.toContain("correct horse");
    expect(user.signupRef).toBe("visitor-1");
    expect(user.sessionVersion).toBe(1);
  });

  it("records the sign-up in the log without the email or the password", async () => {
    const w = accountsWorld();
    await w.accounts.register(SAM, "visitor-1");
    expect(w.events.events).toHaveLength(1);
    const text = JSON.stringify(w.events.events);
    expect(w.events.events[0]).toMatchObject({
      kind: "user",
      type: "register",
      visitor: "visitor-1",
    });
    expect(text).not.toContain("sam@example.com");
    expect(text).not.toContain("correct horse");
  });

  it("refuses an email that already has an account", async () => {
    const w = accountsWorld();
    await w.accounts.register(SAM, "v1");
    const err = await failure(w.accounts.register({ ...SAM, name: "Other" }, "v2"));
    expect(err.code).toBe("duplicate_email");
    expect(err.message).toBe("That email already has an account. Try signing in.");
    expect(w.store.users.size).toBe(1);
  });

  it("lets only one of two sign-ups with the same email win, even at the same moment", async () => {
    const w = accountsWorld();
    // Both check "is it taken?" before either has created the account.
    let release!: () => void;
    w.hasher.gate = new Promise<void>((r) => (release = r));
    const first = w.accounts.register(SAM, "v1");
    const second = w.accounts.register({ ...SAM, name: "Twin" }, "v2");
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as AuthError).code).toBe("duplicate_email");
    expect(w.store.users.size).toBe(1);
  });

  it("allows five sign-ups an hour from one connection, then refuses, then allows again", async () => {
    const w = accountsWorld();
    for (let i = 0; i < 5; i++) {
      await w.accounts.register({ ...SAM, email: `p${i}@example.com` }, "same-visitor");
    }
    const err = await failure(
      w.accounts.register({ ...SAM, email: "p9@example.com" }, "same-visitor"),
    );
    expect(err.code).toBe("too_many");
    // a different person is not affected
    await w.accounts.register({ ...SAM, email: "other@example.com" }, "different-visitor");
    w.advance(3_600_001);
    await w.accounts.register({ ...SAM, email: "p9@example.com" }, "same-visitor");
    expect(w.store.users.size).toBe(7);
  });

  it("does not count a refused sign-up as free: an attacker cannot guess which emails exist faster", async () => {
    const w = accountsWorld();
    await w.accounts.register(SAM, "v1");
    for (let i = 0; i < 5; i++) await failure(w.accounts.register(SAM, "attacker")); // five tries, all told "taken";
    expect((await failure(w.accounts.register(SAM, "attacker"))).code).toBe("too_many");
  });
});

describe("signing in", () => {
  async function withSam() {
    const w = accountsWorld();
    await w.accounts.register(SAM, "v1");
    w.events.events.length = 0;
    return w;
  }

  it("works with the right password, and notes the sign-in", async () => {
    const w = await withSam();
    const user = await w.accounts.login("sam@example.com", "correct horse", "v1");
    expect(user.email).toBe("sam@example.com");
    expect(user.loginCount).toBe(1);
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    expect(w.events.types()).toEqual(["login"]);
  });

  it("gives a wrong password and an unknown email the very same answer", async () => {
    const w = await withSam();
    const wrong = await failure(w.accounts.login("sam@example.com", "nope", "v2"));
    const unknown = await failure(w.accounts.login("nobody@example.com", "nope", "v2"));
    expect(wrong.code).toBe("bad_credentials");
    expect(unknown.code).toBe("bad_credentials");
    expect(unknown.message).toBe(wrong.message);
    expect(wrong.message).toBe("Wrong email or password.");
  });

  it("does the same amount of password work for an unknown email, so timing does not give it away", async () => {
    const w = await withSam();
    const before = w.hasher.verifies;
    await failure(w.accounts.login("nobody@example.com", "nope", "v2"));
    expect(w.hasher.verifies - before).toBe(1);
    await failure(w.accounts.login("sam@example.com", "nope", "v2"));
    expect(w.hasher.verifies - before).toBe(2);
  });

  it("logs failures without the email that was tried", async () => {
    const w = await withSam();
    await failure(w.accounts.login("sam@example.com", "nope", "v2"));
    await failure(w.accounts.login("nobody@example.com", "nope", "v2"));
    const text = JSON.stringify(w.events.events);
    expect(w.events.types()).toEqual(["login_failed", "login_failed"]);
    expect(text).not.toContain("sam@example.com");
    expect(text).not.toContain("nobody@example.com");
    expect(text).not.toContain("nope");
    expect(w.events.events[1]?.detail).toBe("unknown email");
  });

  it("locks out a connection after ten failures, even for the right password, until fifteen minutes pass", async () => {
    const w = await withSam();
    for (let i = 0; i < 10; i++)
      await failure(w.accounts.login(`x${i}@example.com`, "nope", "guesser"));
    const locked = await failure(w.accounts.login("sam@example.com", "correct horse", "guesser"));
    expect(locked.code).toBe("too_many");
    // nobody else is affected
    await w.accounts.login("sam@example.com", "correct horse", "someone-else");
    w.advance(900_001);
    await w.accounts.login("sam@example.com", "correct horse", "guesser");
  });

  it("locks an account after six failures from anywhere, so guessing from many addresses fails too", async () => {
    const w = await withSam();
    for (let i = 0; i < 6; i++)
      await failure(w.accounts.login("sam@example.com", `guess${i}`, `visitor-${i}`));
    const locked = await failure(
      w.accounts.login("sam@example.com", "correct horse", "brand-new-visitor"),
    );
    expect(locked.code).toBe("too_many");
    w.advance(900_001);
    await w.accounts.login("sam@example.com", "correct horse", "brand-new-visitor");
  });

  it("refuses a suspended account with a clear message, but only after the password is right", async () => {
    const w = await withSam();
    const sam = (await w.store.findByEmail("sam@example.com"))!;
    w.store.suspend(sam.id);
    const wrong = await failure(w.accounts.login("sam@example.com", "nope", "v2"));
    expect(wrong.code).toBe("bad_credentials"); // does not reveal that the account exists or is suspended
    const right = await failure(w.accounts.login("sam@example.com", "correct horse", "v2"));
    expect(right.code).toBe("suspended");
    expect(right.message).toMatch(/suspended/);
    expect(w.events.types()).toContain("login_blocked");
    expect(sam.loginCount).toBe(0);
  });

  it("counts every sign-in", async () => {
    const w = await withSam();
    await w.accounts.login("sam@example.com", "correct horse", "v1");
    const again = await w.accounts.login("sam@example.com", "correct horse", "v1");
    expect(again.loginCount).toBe(2);
  });
});

describe("changing the password", () => {
  async function signedIn() {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    w.events.events.length = 0;
    return { w, user };
  }

  it("needs the current password", async () => {
    const { w, user } = await signedIn();
    const err = await failure(w.accounts.changePassword(user, "wrong", "brand new pass", "v1"));
    expect(err.code).toBe("wrong_password");
    expect(err.message).toBe("That password isn't right.");
    expect(await w.accounts.login("sam@example.com", "correct horse", "v1")).toBeDefined();
  });

  it("switches to the new password, and the old one stops working", async () => {
    const { w, user } = await signedIn();
    await w.accounts.changePassword(user, "correct horse", "brand new pass", "v1");
    expect((await failure(w.accounts.login("sam@example.com", "correct horse", "v1"))).code).toBe(
      "bad_credentials",
    );
    expect(await w.accounts.login("sam@example.com", "brand new pass", "v1")).toBeDefined();
  });

  it("signs the account out everywhere by raising the session version", async () => {
    const { w, user } = await signedIn();
    expect(user.sessionVersion).toBe(1);
    const updated = await w.accounts.changePassword(user, "correct horse", "brand new pass", "v1");
    expect(updated.sessionVersion).toBe(2);
    expect(w.events.types()).toEqual(["password_changed"]);
  });

  it("limits guessing of the current password to six tries", async () => {
    const { w, user } = await signedIn();
    for (let i = 0; i < 6; i++)
      await failure(w.accounts.changePassword(user, `guess${i}`, "brand new pass", "v1"));
    const err = await failure(
      w.accounts.changePassword(user, "correct horse", "brand new pass", "v1"),
    );
    expect(err.code).toBe("too_many");
    w.advance(900_001);
    await w.accounts.changePassword(user, "correct horse", "brand new pass", "v1");
  });
});

describe("deleting an account", () => {
  it("needs the password, and keeps the account if it is wrong", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    const err = await failure(w.accounts.deleteAccount(user, { password: "wrong" }, "v1"));
    expect(err.code).toBe("wrong_password");
    expect(w.store.users.size).toBe(1);
  });

  it("removes the account for good, so signing in no longer works and the email is free again", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    w.events.events.length = 0;
    await w.accounts.deleteAccount(user, { password: "correct horse" }, "v1");
    expect(w.store.users.size).toBe(0);
    expect((await failure(w.accounts.login("sam@example.com", "correct horse", "v1"))).code).toBe(
      "bad_credentials",
    );
    expect(w.events.types()).toContain("account_deleted");
    await w.accounts.register(SAM, "v9");
  });
});

describe("what an account owner sees", () => {
  it("exports everything stored about the account, without the password hash or internal details", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    await w.accounts.login("sam@example.com", "correct horse", "v1");
    const data = w.accounts.exportData((await w.store.findById(user.id))!);
    expect(data.account).toMatchObject({
      email: "sam@example.com",
      displayName: "Sam",
      loginCount: 1,
      premiumUntil: null,
    });
    expect(data.account.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(data.account.lastLoginAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const text = JSON.stringify(data);
    expect(text).not.toContain("fake$");
    expect(text).not.toContain("passwordHash");
    expect(text).not.toContain("sessionVersion");
    expect(text).not.toContain("signupRef");
    expect(text).not.toContain("v1");
  });

  it("shows only the name, email, join date and sign-in methods as the public view of an account", async () => {
    const w = accountsWorld();
    const user = await w.accounts.register(SAM, "v1");
    expect(Object.keys(w.accounts.publicUser(user)).sort()).toEqual([
      "createdAt",
      "email",
      "google",
      "hasPassword",
      "name",
    ]);
  });
});
