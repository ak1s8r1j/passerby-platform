import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "pb_admin";
/** How long an admin sign-in lasts. */
export const ADMIN_MS = 12 * 3_600_000;

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`admin-session:${payload}`).digest("hex");

/**
 * The admin's sign-ins. Each one is a random ID signed with the server's secret and remembered here, so
 * signing out really ends it (a copied cookie stops working at once) and "sign out everywhere" is one call.
 * They are kept in memory: restarting the server signs the admin out, which is the safe direction to fail.
 */
export class AdminSessions {
  private live = new Map<string, number>();

  constructor(
    private secret: string,
    private now: () => number = Date.now,
  ) {}

  /** A new sign-in. Returns the cookie value. */
  create(): string {
    const id = randomBytes(24).toString("base64url");
    const expiry = this.now() + ADMIN_MS;
    this.live.set(id, expiry);
    this.sweep();
    const payload = `${id}.${expiry}`;
    return `${payload}.${sign(this.secret, payload)}`;
  }

  /** Is this cookie a genuine, unexpired, not-signed-out admin sign-in? */
  valid(token: string | undefined): boolean {
    const parsed = this.parse(token);
    if (!parsed) return false;
    const expiry = this.live.get(parsed.id);
    return expiry !== undefined && expiry === parsed.expiry && expiry > this.now();
  }

  /** End one sign-in. */
  revoke(token: string | undefined): void {
    const parsed = this.parse(token);
    if (parsed) this.live.delete(parsed.id);
  }

  /** End every admin sign-in. */
  revokeAll(): void {
    this.live.clear();
  }

  get size(): number {
    return this.live.size;
  }

  private parse(token: string | undefined): { id: string; expiry: number } | null {
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [id, expiry, signature] = parts as [string, string, string];
    const a = Buffer.from(signature);
    const b = Buffer.from(sign(this.secret, `${id}.${expiry}`));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const exp = Number(expiry);
    return id && Number.isFinite(exp) ? { id, expiry: exp } : null;
  }

  private sweep(): void {
    const t = this.now();
    for (const [id, expiry] of this.live) if (expiry <= t) this.live.delete(id);
  }
}
