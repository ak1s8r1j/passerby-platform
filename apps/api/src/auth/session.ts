import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pb_sess";
/** How long a sign-in lasts. */
export const SESSION_MS = 30 * 86_400_000;

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`session:${payload}`).digest("hex");

/**
 * The value of the sign-in cookie: `id.expiry.version.signature`.
 * It is signed with the server's secret, so it can't be forged or edited, and it carries the account's
 * session version, so changing the password (or suspending the account) cancels every cookie at once.
 */
export function createSessionToken(
  secret: string,
  user: { id: string; sessionVersion: number },
  now = Date.now(),
): string {
  const payload = `${user.id}.${now + SESSION_MS}.${user.sessionVersion}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Who the cookie says you are, if it is genuine and has not expired. */
export function readSessionToken(
  secret: string,
  token: string | undefined,
  now = Date.now(),
): { id: string; version: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [id, expiry, version, signature] = parts as [string, string, string, string];
  const expected = sign(secret, `${id}.${expiry}.${version}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const exp = Number(expiry);
  const ver = Number(version);
  if (!Number.isFinite(exp) || exp <= now || !Number.isInteger(ver) || !id) return null;
  return { id, version: ver };
}

/** Read one cookie from a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
