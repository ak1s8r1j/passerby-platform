import { describe, expect, it } from "vitest";
import { argon2 } from "../src/auth/passwords.js";

describe("argon2 password hashing (the real thing)", () => {
  it("makes an argon2id hash with the recommended settings, never containing the password", async () => {
    const hash = await argon2.hash("correct horse battery");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain("correct horse battery");
  });

  it("accepts the right password and refuses a wrong one", async () => {
    const hash = await argon2.hash("correct horse");
    expect(await argon2.verify(hash, "correct horse")).toBe(true);
    expect(await argon2.verify(hash, "correct horse ")).toBe(false);
    expect(await argon2.verify(hash, "Correct horse")).toBe(false);
    expect(await argon2.verify(hash, "")).toBe(false);
  });

  it("gives the same password a different hash each time (a random salt), and both still work", async () => {
    const [a, b] = await Promise.all([argon2.hash("same password"), argon2.hash("same password")]);
    expect(a).not.toBe(b);
    expect(await argon2.verify(a, "same password")).toBe(true);
    expect(await argon2.verify(b, "same password")).toBe(true);
  });

  it("copes with any characters, including emoji and non-Latin scripts", async () => {
    for (const pw of [
      "pässwörd",
      "密码密码密码",
      "🔒🔑🔒🔑🔒🔑",
      "x".repeat(128),
      "   spaces   ",
    ]) {
      const hash = await argon2.hash(pw);
      expect(await argon2.verify(hash, pw), pw).toBe(true);
    }
  });

  it("says no, rather than crashing, for a damaged or foreign hash", async () => {
    expect(await argon2.verify("", "x")).toBe(false);
    expect(await argon2.verify("not a hash", "x")).toBe(false);
    expect(await argon2.verify("$argon2id$v=19$m=1$broken", "x")).toBe(false);
    expect(
      await argon2.verify("$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234", "x"),
    ).toBe(false);
  });

  it("is slow enough to matter to an attacker but fast enough for a visitor", async () => {
    const start = performance.now();
    await argon2.hash("timing check");
    const ms = performance.now() - start;
    expect(ms).toBeGreaterThan(1); // it does real work
    expect(ms).toBeLessThan(2000); // and a visitor never waits long
  });
});
