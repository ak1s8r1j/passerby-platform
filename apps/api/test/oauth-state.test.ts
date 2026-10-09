import { describe, expect, it } from "vitest";
import { OAUTH_MS, openState, sealState, type OAuthState } from "../src/auth/oauth-state.js";

const SECRET = "an-oauth-test-secret-123456";
const NOW = 1_800_000_000_000;
const state = (over: Partial<OAuthState> = {}): OAuthState => ({
  state: "s-1",
  nonce: "n-1",
  verifier: "v-1",
  adult: true,
  link: "",
  exp: NOW + OAUTH_MS,
  ...over,
});

describe("the cookie that remembers a Google sign-in in progress", () => {
  it("comes back exactly as it was sealed", () => {
    const s = state({ adult: false, link: "user-42" });
    expect(openState(SECRET, sealState(SECRET, s), NOW)).toEqual(s);
  });

  it("lasts ten minutes, and no longer", () => {
    const token = sealState(SECRET, state());
    expect(openState(SECRET, token, NOW + OAUTH_MS - 1)).not.toBeNull();
    expect(openState(SECRET, token, NOW + OAUTH_MS)).toBeNull();
  });

  it("is refused if sealed with a different secret", () => {
    expect(openState("some-other-secret-entirely-1", sealState(SECRET, state()), NOW)).toBeNull();
  });

  it("is refused if the visitor edits what is inside it (to change who it links to, or to skip the age box)", () => {
    const [payload, signature] = sealState(SECRET, state({ adult: false })).split(".") as [
      string,
      string,
    ];
    const edited = Buffer.from(
      JSON.stringify({ ...state({ adult: false }), adult: true }),
    ).toString("base64url");
    expect(openState(SECRET, `${edited}.${signature}`, NOW)).toBeNull();
    const relinked = Buffer.from(JSON.stringify({ ...state(), link: "someone-else" })).toString(
      "base64url",
    );
    expect(openState(SECRET, `${relinked}.${signature}`, NOW)).toBeNull();
    expect(openState(SECRET, `${payload}.${signature}`, NOW)).not.toBeNull();
  });

  it("is refused if it is garbage, or has the wrong shape inside", () => {
    for (const bad of ["", "abc", "a.b.c", ".", "..", undefined]) {
      expect(openState(SECRET, bad, NOW), String(bad)).toBeNull();
    }
    // correctly signed, but not an OAuthState
    const payload = Buffer.from(JSON.stringify({ state: 5 })).toString("base64url");
    const good = sealState(SECRET, state()).split(".")[1]!;
    expect(openState(SECRET, `${payload}.${good}`, NOW)).toBeNull();
  });
});
