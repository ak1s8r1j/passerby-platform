import { createHmac, timingSafeEqual } from "node:crypto";

export const OAUTH_COOKIE = "pb_oauth";
/** The person has this long to log in at Google and come back. */
export const OAUTH_MS = 10 * 60_000;

/** What we remember between sending someone to Google and Google sending them back. */
export interface OAuthState {
  /** A one-time random value Google must hand back unchanged, so we know the return trip is ours. */
  state: string;
  /** Goes into the login token, so a token made for another request is useless here. */
  nonce: string;
  /** The PKCE secret that proves the code is being redeemed by whoever asked for it. */
  verifier: string;
  /** They ticked the 18+ box before starting (needed to create a new account). */
  adult: boolean;
  /** When connecting Google to an existing account: whose. Empty for an ordinary sign-in. */
  link: string;
  exp: number;
}

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`oauth:${payload}`).digest("base64url");

/** Pack it into a signed cookie value, so the visitor's browser cannot edit it. */
export function sealState(secret: string, s: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  return `${payload}.${sign(secret, payload)}`;
}

/** Read it back: null if it was edited, made with another secret, or has expired. */
export function openState(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): OAuthState | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  const a = Buffer.from(signature);
  const b = Buffer.from(sign(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<OAuthState>;
    if (
      typeof s.state !== "string" ||
      typeof s.nonce !== "string" ||
      typeof s.verifier !== "string" ||
      typeof s.adult !== "boolean" ||
      typeof s.link !== "string" ||
      typeof s.exp !== "number" ||
      s.exp <= now
    ) {
      return null;
    }
    return s as OAuthState;
  } catch {
    return null;
  }
}
