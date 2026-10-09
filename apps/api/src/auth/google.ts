import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

/** What we learn about a person from Google, once their login token has been checked. */
export interface GoogleProfile {
  /** Google's permanent ID for this person. Unlike an email address, it never changes or gets reused. */
  sub: string;
  email: string;
  /** Google vouches that the person controls this email address. */
  emailVerified: boolean;
  /** Their name as Google has it (may be empty). */
  name: string;
}

export interface GoogleEndpoints {
  authUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  /** Who may have issued the login token. */
  issuers: string[];
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};

/** The login did not work out. `reason` is for the log; the visitor is only told "it didn't work". */
export class GoogleError extends Error {
  constructor(
    public reason: "exchange_failed" | "invalid_token" | "network",
    message: string,
  ) {
    super(message);
  }
}

/** What the routes need from Google. Tests swap in a stand-in. */
export interface GoogleSignIn {
  /** Where to send the visitor to log in at Google. */
  authorizeUrl(p: { state: string; nonce: string; challenge: string }): string;
  /** Turn the one-time `code` Google sent back into a checked profile. */
  profileFor(p: { code: string; verifier: string; nonce: string }): Promise<GoogleProfile>;
}

/** A fresh random secret, and its fingerprint, for PKCE (see `authorizeUrl`). */
export function newPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export interface GoogleOAuthOptions {
  clientId: string;
  clientSecret: string;
  /** Where Google sends the visitor back to. It must be listed in the Google Cloud console. */
  redirectUri: string;
  endpoints?: GoogleEndpoints;
  /** Overridable so tests need no network. */
  fetch?: typeof fetch;
}

/**
 * "Continue with Google", by the standard "authorization code with PKCE" route:
 *  1. send the visitor to Google with a one-time `state`, `nonce` and PKCE challenge;
 *  2. Google sends them back with a one-time `code`;
 *  3. we swap the code for a signed login token, using our secret and the PKCE verifier;
 *  4. we check the token's signature against Google's published keys, and who it is for, who issued it,
 *     when it expires, and that it answers OUR `nonce`.
 * Only then do we believe who the person is.
 */
export class GoogleOAuth implements GoogleSignIn {
  private endpoints: GoogleEndpoints;
  private keys: ReturnType<typeof createRemoteJWKSet>;
  private http: typeof fetch;

  constructor(private options: GoogleOAuthOptions) {
    this.endpoints = options.endpoints ?? GOOGLE_ENDPOINTS;
    this.keys = createRemoteJWKSet(new URL(this.endpoints.jwksUrl), { timeoutDuration: 5000 });
    this.http = options.fetch ?? fetch;
  }

  authorizeUrl({
    state,
    nonce,
    challenge,
  }: {
    state: string;
    nonce: string;
    challenge: string;
  }): string {
    const url = new URL(this.endpoints.authUrl);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account", // always let them pick the account, so a shared computer does not auto-sign-in
    }).toString();
    return url.toString();
  }

  async profileFor({
    code,
    verifier,
    nonce,
  }: {
    code: string;
    verifier: string;
    nonce: string;
  }): Promise<GoogleProfile> {
    const idToken = await this.exchange(code, verifier);
    let payload;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        issuer: this.endpoints.issuers,
        audience: this.options.clientId,
        algorithms: ["RS256"], // never accept "none", or a shared-secret algorithm someone could forge
      }));
    } catch (err) {
      throw new GoogleError("invalid_token", `login token refused: ${(err as Error).message}`);
    }
    if (typeof payload.nonce !== "string" || !sameText(payload.nonce, nonce)) {
      throw new GoogleError("invalid_token", "login token answers a different request");
    }
    if (
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      !payload.email
    ) {
      throw new GoogleError("invalid_token", "login token has no id or email");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: typeof payload.name === "string" ? payload.name : "",
    };
  }

  /** Swap the one-time code for the login token. */
  private async exchange(code: string, verifier: string): Promise<string> {
    let res: Response;
    try {
      res = await this.http(this.endpoints.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          redirect_uri: this.options.redirectUri,
          code_verifier: verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new GoogleError("network", `could not reach Google: ${(err as Error).message}`);
    }
    const body: unknown = await res.json().catch(() => null);
    const token = (body as { id_token?: unknown } | null)?.id_token;
    if (!res.ok || typeof token !== "string" || !token) {
      throw new GoogleError("exchange_failed", `Google refused the code (HTTP ${res.status})`);
    }
    return token;
  }
}
