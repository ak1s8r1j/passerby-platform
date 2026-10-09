/**
 * A stand-in for Google's sign-in, for trying "Continue with Google" in a real browser without a
 * Google account or credentials. It signs real RS256 login tokens, checks the secret and the PKCE
 * proof like Google does, and is steered over HTTP by e2e/google_flow.py:
 *
 *   POST /control  {"person": {sub,email,name,email_verified}, "mode": "ok"|"cancel", "tamper": "none"|"nonce"|"aud"|"key"}
 *   GET  /log      what the app asked of it (token requests, so the test can see the secret and PKCE arrived)
 *
 * It is a TEST tool. Run it, then start the app with:
 *   GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret
 *   GOOGLE_AUTH_URL=http://localhost:3300/authorize GOOGLE_TOKEN_URL=http://localhost:3300/token
 *   GOOGLE_JWKS_URL=http://localhost:3300/jwks GOOGLE_ISSUER=http://localhost:3300
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const PORT = Number(process.env.FAKE_GOOGLE_PORT ?? 3300);
const ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "test-client";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "test-secret";

const good = await generateKeyPair("RS256");
const evil = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const state = {
  person: {
    sub: "g-default",
    email: "default@example.com",
    name: "Default Person",
    email_verified: true,
  },
  mode: "ok",
  tamper: "none",
  codes: new Map(), // code -> what it was issued for
  tokenRequests: [],
};

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);

  if (url.pathname === "/authorize") {
    const q = url.searchParams;
    const redirect = q.get("redirect_uri") ?? "";
    if (q.get("client_id") !== CLIENT_ID || !redirect)
      return send(res, 400, { error: "bad client" });
    const back = new URL(redirect);
    back.searchParams.set("state", q.get("state") ?? "");
    if (state.mode === "cancel") {
      back.searchParams.set("error", "access_denied");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    const code = randomBytes(16).toString("hex");
    state.codes.set(code, {
      nonce: q.get("nonce"),
      challenge: q.get("code_challenge"),
      redirect,
      person: { ...state.person },
      tamper: state.tamper,
    });
    back.searchParams.set("code", code);
    res.writeHead(302, { location: back.toString() });
    return res.end();
  }

  if (url.pathname === "/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    state.tokenRequests.push({
      hadSecret: form.get("client_secret") === CLIENT_SECRET,
      hadVerifier: Boolean(form.get("code_verifier")),
    });
    const issued = state.codes.get(form.get("code") ?? "");
    state.codes.delete(form.get("code") ?? ""); // a code works once
    const proof = createHash("sha256")
      .update(form.get("code_verifier") ?? "")
      .digest("base64url");
    if (
      !issued ||
      form.get("client_id") !== CLIENT_ID ||
      form.get("client_secret") !== CLIENT_SECRET ||
      form.get("redirect_uri") !== issued.redirect ||
      proof !== issued.challenge
    ) {
      return send(res, 400, { error: "invalid_grant" });
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      email: issued.person.email,
      email_verified: issued.person.email_verified ?? true,
      name: issued.person.name,
      nonce: issued.tamper === "nonce" ? "somebody-elses-nonce" : issued.nonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setSubject(issued.person.sub)
      .setIssuer(ISSUER)
      .setAudience(issued.tamper === "aud" ? "another-app" : CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(issued.tamper === "key" ? evil.privateKey : good.privateKey);
    return send(res, 200, { id_token: token, access_token: "unused", token_type: "Bearer" });
  }

  if (url.pathname === "/jwks") return send(res, 200, { keys: [jwk] });

  if (url.pathname === "/control" && req.method === "POST") {
    const next = JSON.parse((await readBody(req)) || "{}");
    if (next.person) state.person = next.person;
    if (next.mode) state.mode = next.mode;
    if (next.tamper) state.tamper = next.tamper;
    state.tokenRequests = [];
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/log") return send(res, 200, { tokenRequests: state.tokenRequests });
  if (url.pathname === "/healthz") return send(res, 200, { ok: true });

  send(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`fake google on ${ISSUER}`));
