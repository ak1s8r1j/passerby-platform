import { createHash, randomBytes, type webcrypto } from "node:crypto";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import type { GoogleEndpoints } from "../src/auth/google.js";

type Key = webcrypto.CryptoKey;

export const CLIENT_ID = "test-client-id.apps.example";
export const CLIENT_SECRET = "test-client-secret";
export const REDIRECT_URI = "http://localhost:5173/api/v1/auth/google/callback";

export interface Person {
  sub: string;
  email: string;
  name?: string;
  /** Defaults to true, like a normal Google account. */
  email_verified?: boolean;
}

/** Ways to make the login token wrong, to check each one is refused. */
export interface Tamper {
  nonce?: string | null;
  aud?: string;
  iss?: string;
  /** Seconds from now; negative = already expired. */
  expiresIn?: number;
  /** Seconds from now before the token becomes valid. */
  notBefore?: number;
  /** Sign with a different key (the right key id, the wrong key). */
  wrongKey?: boolean;
  /** Use another signing method entirely. */
  alg?: "HS256" | "none";
  omit?: ("sub" | "email" | "email_verified")[];
}

/**
 * A stand-in for Google, as a real local web server: it has a token endpoint and a key list,
 * and signs login tokens with a real RSA key. Tests drive the real GoogleOAuth code against it.
 */
export class FakeGoogle {
  private codes = new Map<
    string,
    { person: Person; nonce: string; challenge: string; tamper: Tamper }
  >();
  private privateKey!: Key;
  private otherKey!: Key;
  private jwk!: JWK;
  private server!: Server;
  base = "";
  /** Every request to the token endpoint, as Google would have seen it. */
  tokenRequests: URLSearchParams[] = [];
  /** Make the token endpoint answer with this instead of working. */
  tokenFailure: { status: number; body: string } | null = null;

  async start(): Promise<this> {
    const pair = await generateKeyPair("RS256", { extractable: true });
    this.privateKey = pair.privateKey;
    this.otherKey = (await generateKeyPair("RS256")).privateKey;
    this.jwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      if (url.pathname === "/jwks") {
        res.setHeader("content-type", "application/json");
        return void res.end(JSON.stringify({ keys: [this.jwk] }));
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        return void (await this.token(new URLSearchParams(raw), res));
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get endpoints(): GoogleEndpoints {
    return {
      authUrl: `${this.base}/auth`,
      tokenUrl: `${this.base}/token`,
      jwksUrl: `${this.base}/jwks`,
      issuers: ["https://accounts.google.com", "accounts.google.com"],
    };
  }

  /** Google has just sent a visitor back with a code: remember what that code is good for. */
  issueCode(
    person: Person,
    request: { nonce: string; challenge: string },
    tamper: Tamper = {},
  ): string {
    const code = randomBytes(12).toString("hex");
    this.codes.set(code, { person, nonce: request.nonce, challenge: request.challenge, tamper });
    return code;
  }

  /** Read what a start URL asked Google for. */
  static requestFrom(authorizeUrl: string) {
    const q = new URL(authorizeUrl).searchParams;
    return {
      state: q.get("state") ?? "",
      nonce: q.get("nonce") ?? "",
      challenge: q.get("code_challenge") ?? "",
      redirectUri: q.get("redirect_uri") ?? "",
    };
  }

  private async token(form: URLSearchParams, res: ServerResponse) {
    this.tokenRequests.push(form);
    const reply = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (this.tokenFailure) return reply(this.tokenFailure.status, this.tokenFailure.body);
    const entry = this.codes.get(form.get("code") ?? "");
    this.codes.delete(form.get("code") ?? ""); // a code works once
    if (
      !entry ||
      form.get("grant_type") !== "authorization_code" ||
      form.get("client_id") !== CLIENT_ID ||
      form.get("client_secret") !== CLIENT_SECRET ||
      form.get("redirect_uri") !== REDIRECT_URI ||
      // PKCE: the verifier must hash to the challenge sent at the start
      createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url") !== entry.challenge
    ) {
      return reply(400, { error: "invalid_grant" });
    }
    reply(200, {
      access_token: "unused",
      id_token: await this.sign(entry.person, entry.nonce, entry.tamper),
    });
  }

  /** A signed login token for `person`, optionally broken in some way. */
  async sign(person: Person, nonce: string, t: Tamper = {}): Promise<string> {
    const claims: Record<string, unknown> = {
      sub: person.sub,
      email: person.email,
      email_verified: person.email_verified ?? true,
      name: person.name,
    };
    if (t.nonce !== null) claims.nonce = t.nonce ?? nonce;
    for (const k of t.omit ?? []) delete claims[k];
    const jwt = new SignJWT(claims)
      .setIssuer(t.iss ?? "https://accounts.google.com")
      .setAudience(t.aud ?? CLIENT_ID)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + (t.expiresIn ?? 3600));
    if (t.notBefore) jwt.setNotBefore(Math.floor(Date.now() / 1000) + t.notBefore);
    if (t.alg === "none") {
      // an unsigned token: header says "none" and there is no signature
      const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
      const payload = {
        ...claims,
        iss: t.iss ?? "https://accounts.google.com",
        aud: t.aud ?? CLIENT_ID,
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      return `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.`;
    }
    if (t.alg === "HS256") {
      // the classic attack: sign with a shared secret, hoping the server treats the public key as one
      return jwt
        .setProtectedHeader({ alg: "HS256", kid: "key-1" })
        .sign(new TextEncoder().encode(JSON.stringify(this.jwk)));
    }
    return jwt
      .setProtectedHeader({ alg: "RS256", kid: "key-1" })
      .sign(t.wrongKey ? this.otherKey : this.privateKey);
  }
}
