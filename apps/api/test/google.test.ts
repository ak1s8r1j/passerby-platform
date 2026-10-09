import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleError, GoogleOAuth, newPkce } from "../src/auth/google.js";
import {
  CLIENT_ID,
  CLIENT_SECRET,
  FakeGoogle,
  REDIRECT_URI,
  type Person,
  type Tamper,
} from "./fake-google.js";

let google: FakeGoogle;
let oauth: GoogleOAuth;
beforeAll(async () => {
  google = await new FakeGoogle().start();
  oauth = new GoogleOAuth({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    endpoints: google.endpoints,
  });
});
afterAll(async () => {
  await google.stop();
});

const RILEY: Person = { sub: "1234567890", email: "riley@example.com", name: "Riley Q" };

/** Start a login, let the visitor 'log in at Google', and redeem the code, the way the routes do. */
async function login(
  person: Person = RILEY,
  tamper: Tamper = {},
  over: { nonce?: string; verifier?: string } = {},
) {
  const { verifier, challenge } = newPkce();
  const nonce = "nonce-" + Math.random().toString(36).slice(2);
  const url = oauth.authorizeUrl({ state: "state-1", nonce, challenge });
  const asked = FakeGoogle.requestFrom(url);
  const code = google.issueCode(person, { nonce: asked.nonce, challenge: asked.challenge }, tamper);
  return oauth.profileFor({
    code,
    verifier: over.verifier ?? verifier,
    nonce: over.nonce ?? nonce,
  });
}

/** The reason a login was refused. */
async function refusal(p: Promise<unknown>): Promise<GoogleError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof GoogleError) return err;
    throw err;
  }
  throw new Error("expected the login to be refused, but it worked");
}

describe("sending the visitor to Google", () => {
  const { challenge } = newPkce();
  const url = new URL(oauth0().authorizeUrl({ state: "S", nonce: "N", challenge }));
  function oauth0() {
    return new GoogleOAuth({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      endpoints: {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "x:",
        jwksUrl: "https://x.test/jwks",
        issuers: [],
      },
    });
  }
  const q = url.searchParams;

  it("goes to Google's login page", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("asks for a code (never a token in the address bar), for only the name and email", () => {
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("openid email profile");
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(REDIRECT_URI);
  });

  it("carries the one-time state and nonce, and the PKCE fingerprint", () => {
    expect(q.get("state")).toBe("S");
    expect(q.get("nonce")).toBe("N");
    expect(q.get("code_challenge")).toBe(challenge);
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  it("always lets the person choose the account, so a shared computer does not sign in by itself", () => {
    expect(q.get("prompt")).toBe("select_account");
  });

  it("never includes the client secret", () => {
    expect(url.toString()).not.toContain(CLIENT_SECRET);
  });
});

describe("PKCE", () => {
  it("makes a different secret every time, with a matching fingerprint", () => {
    const a = newPkce();
    const b = newPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(a.challenge).not.toBe(a.verifier);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("a genuine login", () => {
  it("gives back who the person is", async () => {
    expect(await login()).toEqual({
      sub: "1234567890",
      email: "riley@example.com",
      emailVerified: true,
      name: "Riley Q",
    });
  });

  it("sends Google the code, our secret, the redirect address and the PKCE verifier", async () => {
    google.tokenRequests.length = 0;
    await login();
    const sent = google.tokenRequests[0]!;
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(sent.get("client_secret")).toBe(CLIENT_SECRET);
    expect(sent.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(sent.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it("reports an email Google has not verified as unverified (the caller decides what to do)", async () => {
    expect((await login({ ...RILEY, email_verified: false })).emailVerified).toBe(false);
    expect((await login(RILEY, { omit: ["email_verified"] })).emailVerified).toBe(false);
  });

  it("copes with no name", async () => {
    expect((await login({ sub: "9", email: "x@example.com" })).name).toBe("");
  });

  it("accepts both spellings of Google's issuer", async () => {
    expect((await login(RILEY, { iss: "accounts.google.com" })).sub).toBe(RILEY.sub);
  });
});

describe("a login that must be refused", () => {
  it.each<[string, Tamper]>([
    ["made for a different request (wrong nonce)", { nonce: "someone-elses-nonce" }],
    ["with no nonce at all", { nonce: null }],
    ["made for a different website (wrong audience)", { aud: "another-client.apps.example" }],
    ["from someone pretending to be Google (wrong issuer)", { iss: "https://evil.example" }],
    ["that has expired", { expiresIn: -120 }],
    ["that is not valid yet", { notBefore: 3600 }],
    ["signed with some other key", { wrongKey: true }],
    ["with no signature at all (alg none)", { alg: "none" }],
    ["signed with a shared secret instead of Google's key (algorithm confusion)", { alg: "HS256" }],
    ["without a person's id", { omit: ["sub"] }],
    ["without an email", { omit: ["email"] }],
  ])("refuses a token %s", async (_name, tamper) => {
    const err = await refusal(login(RILEY, tamper));
    expect(err.reason).toBe("invalid_token");
  });

  it("refuses when the nonce we remembered is not the one in the token", async () => {
    expect((await refusal(login(RILEY, {}, { nonce: "a-different-one" }))).reason).toBe(
      "invalid_token",
    );
  });

  it("refuses when the PKCE secret doesn't match, because Google refuses the code", async () => {
    expect((await refusal(login(RILEY, {}, { verifier: "x".repeat(43) }))).reason).toBe(
      "exchange_failed",
    );
  });

  it("refuses a code that was never issued, or has already been used", async () => {
    const { verifier } = newPkce();
    expect(
      (await refusal(oauth.profileFor({ code: "made-up", verifier, nonce: "n" }))).reason,
    ).toBe("exchange_failed");

    const p = newPkce();
    const asked = FakeGoogle.requestFrom(
      oauth.authorizeUrl({ state: "s", nonce: "n1", challenge: p.challenge }),
    );
    const code = google.issueCode(RILEY, { nonce: asked.nonce, challenge: asked.challenge });
    await oauth.profileFor({ code, verifier: p.verifier, nonce: "n1" });
    expect(
      (await refusal(oauth.profileFor({ code, verifier: p.verifier, nonce: "n1" }))).reason,
    ).toBe("exchange_failed");
  });
});

describe("when Google misbehaves", () => {
  it.each([
    [500, "Internal error"],
    [400, '{"error":"invalid_client"}'],
    [200, "this is not json"],
    [200, "{}"],
    [200, '{"id_token":""}'],
    [200, '{"id_token":42}'],
  ])("is not fooled by an answer of %i %j", async (status, body) => {
    google.tokenFailure = { status, body };
    try {
      expect((await refusal(login())).reason).toBe("exchange_failed");
    } finally {
      google.tokenFailure = null;
    }
  });

  it("copes with Google being unreachable", async () => {
    const dead = new GoogleOAuth({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUri: REDIRECT_URI,
      endpoints: { ...google.endpoints, tokenUrl: "http://127.0.0.1:1/token" },
    });
    expect((await refusal(dead.profileFor({ code: "c", verifier: "v", nonce: "n" }))).reason).toBe(
      "network",
    );
  });

  it("never puts the client secret into an error message", async () => {
    google.tokenFailure = { status: 400, body: "{}" };
    try {
      const err = await refusal(login());
      expect(err.message).not.toContain(CLIENT_SECRET);
    } finally {
      google.tokenFailure = null;
    }
  });
});
