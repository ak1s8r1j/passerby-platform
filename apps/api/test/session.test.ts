import { describe, expect, it } from "vitest";
import {
  cookieValue,
  createSessionToken,
  readSessionToken,
  SESSION_MS,
} from "../src/auth/session.js";

const SECRET = "a-secret-that-is-long-enough";
const USER = { id: "ckabc123def456ghi789jkl01", sessionVersion: 3 };
const NOW = 1_800_000_000_000;

describe("sign-in cookie", () => {
  it("names the account and its version when it is genuine", () => {
    const token = createSessionToken(SECRET, USER, NOW);
    expect(readSessionToken(SECRET, token, NOW + 1000)).toEqual({ id: USER.id, version: 3 });
  });

  it("lasts 30 days, and no longer", () => {
    const token = createSessionToken(SECRET, USER, NOW);
    expect(readSessionToken(SECRET, token, NOW + SESSION_MS - 1)).not.toBeNull();
    expect(readSessionToken(SECRET, token, NOW + SESSION_MS)).toBeNull();
    expect(readSessionToken(SECRET, token, NOW + SESSION_MS + 86_400_000)).toBeNull();
  });

  it("is refused if it was signed with a different secret", () => {
    const token = createSessionToken(SECRET, USER, NOW);
    expect(readSessionToken("another-secret-entirely-1234", token, NOW)).toBeNull();
  });

  it("is refused if any part has been edited", () => {
    const [id, exp, version, sig] = createSessionToken(SECRET, USER, NOW).split(".") as [
      string,
      string,
      string,
      string,
    ];
    expect(readSessionToken(SECRET, [id, exp, version, sig].join("."), NOW)).not.toBeNull();
    expect(readSessionToken(SECRET, ["ckother", exp, version, sig].join("."), NOW)).toBeNull(); // someone else's id
    expect(
      readSessionToken(SECRET, [id, String(Number(exp) + 9e9), version, sig].join("."), NOW),
    ).toBeNull(); // longer life
    expect(readSessionToken(SECRET, [id, exp, "4", sig].join("."), NOW)).toBeNull(); // newer version
    expect(
      readSessionToken(
        SECRET,
        [id, exp, version, sig.replace(/.$/, (c) => (c === "0" ? "1" : "0"))].join("."),
        NOW,
      ),
    ).toBeNull();
  });

  it("is refused if it is not shaped like a cookie we made", () => {
    for (const bad of [
      "",
      "abc",
      "a.b.c",
      "a.b.c.d.e",
      "....",
      "id.notanumber.1.sig",
      "id.123.x.sig",
      undefined,
    ]) {
      expect(readSessionToken(SECRET, bad, NOW), String(bad)).toBeNull();
    }
  });

  it("is refused if the signature has the wrong length (and does not throw)", () => {
    const [id, exp, version] = createSessionToken(SECRET, USER, NOW).split(".");
    expect(readSessionToken(SECRET, `${id}.${exp}.${version}.abcd`, NOW)).toBeNull();
    expect(readSessionToken(SECRET, `${id}.${exp}.${version}.`, NOW)).toBeNull();
  });

  it("differs for different versions, so a password change makes old cookies useless", () => {
    const before = createSessionToken(SECRET, { ...USER, sessionVersion: 1 }, NOW);
    const after = createSessionToken(SECRET, { ...USER, sessionVersion: 2 }, NOW);
    expect(before).not.toBe(after);
    expect(readSessionToken(SECRET, before, NOW)?.version).toBe(1);
    expect(readSessionToken(SECRET, after, NOW)?.version).toBe(2);
  });
});

describe("cookieValue", () => {
  it("finds one cookie among several", () => {
    expect(cookieValue("a=1; pb_sess=tok.en; b=2", "pb_sess")).toBe("tok.en");
    expect(cookieValue("pb_sess=first", "pb_sess")).toBe("first");
  });

  it("does not confuse a cookie with a similar name", () => {
    expect(cookieValue("xpb_sess=wrong; pb_sess_old=wrong2", "pb_sess")).toBeUndefined();
    expect(cookieValue("pb_sess2=wrong", "pb_sess")).toBeUndefined();
  });

  it("copes with a missing or odd header", () => {
    expect(cookieValue(undefined, "pb_sess")).toBeUndefined();
    expect(cookieValue("", "pb_sess")).toBeUndefined();
    expect(cookieValue("novalue", "pb_sess")).toBeUndefined();
    expect(cookieValue(";;; =x; pb_sess=ok", "pb_sess")).toBe("ok");
  });

  it("keeps an equals sign inside the value", () => {
    expect(cookieValue("pb_sess=a=b=c", "pb_sess")).toBe("a=b=c");
  });
});
