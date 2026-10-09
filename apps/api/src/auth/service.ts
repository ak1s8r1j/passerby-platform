import { randomBytes } from "node:crypto";
import { DisplayName, EmailAddress, type PublicUser, type RegisterRequest } from "@passerby/shared";
import type { EventSink } from "../events.js";
import type { GoogleProfile } from "./google.js";
import type { Hasher } from "./passwords.js";
import type { Limiter } from "./limiter.js";
import {
  DuplicateEmailError,
  DuplicateGoogleError,
  type UserRecord,
  type UserStore,
} from "./store.js";

export type AuthErrorCode =
  | "duplicate_email"
  | "bad_credentials"
  | "suspended"
  | "too_many"
  | "wrong_password"
  | "wrong_confirmation"
  // Google
  | "google_unverified"
  | "email_in_use"
  | "adult_required"
  | "banned"
  | "google_in_use"
  | "no_password";

/** Something went wrong that the visitor should be told about. `message` is written to be shown as it is. */
export class AuthError extends Error {
  constructor(
    public code: AuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const REGISTER_MAX = 5;
const REGISTER_WINDOW_MS = 3_600_000;
const LOCKOUT_WINDOW_MS = 900_000;
const LOGIN_MAX_PER_VISITOR = 10;
const LOGIN_MAX_PER_EMAIL = 6;
const SENSITIVE_MAX_PER_ACCOUNT = 6;
const GOOGLE_MAX_PER_VISITOR = 20;

export interface AccountsDeps {
  store: UserStore;
  hasher: Hasher;
  events: EventSink;
  limiter: Limiter;
}

const tag = (u: { id: string }) => `user:${u.id.slice(0, 6)}`;

/**
 * A display name made from what Google says the person is called, fitted to our rules
 * (letters, numbers, spaces, dot, underscore, hyphen; 2 to 24 long). Falls back to the start of their email.
 */
export function nameFromGoogle(name: string, email: string): string {
  const tidy = (s: string) =>
    s
      .normalize("NFC")
      .replace(/[^\p{L}\p{N} ._-]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24)
      .trim();
  for (const candidate of [tidy(name), tidy(email.split("@")[0] ?? "")]) {
    const ok = DisplayName.safeParse(candidate);
    if (ok.success) return ok.data;
  }
  return "Google user";
}

/**
 * Every rule about accounts, with no HTTP and no database in it:
 * who can register, how sign-in is protected from guessing, what changing a password does,
 * and how signing in with Google may and may not join up with an existing account.
 */
export class Accounts {
  private dummyHash: Promise<string> | null = null;

  constructor(private deps: AccountsDeps) {}

  async register(input: RegisterRequest, visitor: string): Promise<UserRecord> {
    const { store, hasher, events, limiter } = this.deps;
    if (!limiter.take(`reg:${visitor}`, REGISTER_MAX, REGISTER_WINDOW_MS)) {
      throw new AuthError("too_many", "Too many sign-ups from this connection. Try again later.");
    }
    const taken = () =>
      new AuthError("duplicate_email", "That email already has an account. Try signing in.");
    if (await store.findByEmail(input.email)) throw taken();

    const passwordHash = await hasher.hash(input.password);
    let user: UserRecord;
    try {
      user = await store.create({
        email: input.email,
        displayName: input.name,
        passwordHash,
        signupRef: visitor,
      });
    } catch (err) {
      // Two sign-ups with the same email at the same moment: the database lets only one win.
      if (err instanceof DuplicateEmailError) throw taken();
      throw err;
    }
    events.record({ kind: "user", type: "register", visitor, detail: tag(user) });
    return user;
  }

  async login(email: string, password: string, visitor: string): Promise<UserRecord> {
    const { store, hasher, events, limiter } = this.deps;
    if (
      limiter.count(`lf:v:${visitor}`, LOCKOUT_WINDOW_MS) >= LOGIN_MAX_PER_VISITOR ||
      limiter.count(`lf:e:${email}`, LOCKOUT_WINDOW_MS) >= LOGIN_MAX_PER_EMAIL
    ) {
      throw new AuthError("too_many", "Too many attempts. Try again in a few minutes.");
    }

    const user = await store.findByEmail(email);
    // Check against a dummy when there is no password to check, so that is not faster than a wrong password.
    const good = await hasher.verify(user?.passwordHash ?? (await this.dummy()), password);
    // `user.passwordHash` must be checked on its own: someone with no password (Google only) is checked
    // against the dummy above, and a "match" against the dummy must never let anyone in.
    if (!user || !user.passwordHash || !good) {
      limiter.strike(`lf:v:${visitor}`, LOCKOUT_WINDOW_MS);
      limiter.strike(`lf:e:${email}`, LOCKOUT_WINDOW_MS);
      events.record({
        kind: "user",
        type: "login_failed",
        visitor,
        detail: user ? `wrong password for ${tag(user)}` : "unknown email",
      });
      throw new AuthError("bad_credentials", "Wrong email or password.");
    }
    if (user.disabledAt) {
      events.record({
        kind: "user",
        type: "login_blocked",
        visitor,
        detail: `suspended ${tag(user)}`,
      });
      throw new AuthError("suspended", "This account is suspended. Contact the site operator.");
    }
    const updated = await store.recordLogin(user.id);
    events.record({ kind: "user", type: "login", visitor, detail: tag(user) });
    return updated;
  }

  // ---------- Google ----------

  /** Limit how often one connection can start or finish a Google sign-in. */
  googleAttempt(visitor: string): void {
    if (!this.deps.limiter.take(`google:${visitor}`, GOOGLE_MAX_PER_VISITOR, LOCKOUT_WINDOW_MS)) {
      throw new AuthError("too_many", "Too many attempts. Try again in a few minutes.");
    }
  }

  /**
   * Someone came back from Google as `profile`. Sign them in if they have connected Google before,
   * or make them an account if the email is new. If an account with that email already exists we do
   * NOT join the two: sign-ups here don't verify email, so anyone could have made that account for an
   * address that isn't theirs, then wait for the real owner to sign in with Google.
   */
  async googleSignIn(
    profile: GoogleProfile,
    ctx: { visitor: string; adult: boolean; banned: boolean },
  ): Promise<{ user: UserRecord; created: boolean }> {
    const { store, events } = this.deps;
    const { visitor } = ctx;
    if (!profile.emailVerified) {
      throw new AuthError(
        "google_unverified",
        "Google says that email address isn't verified, so we can't use it.",
      );
    }

    const known = await store.findByGoogleSub(profile.sub);
    if (known) return { user: await this.googleLogin(known, visitor), created: false };

    const email = EmailAddress.safeParse(profile.email);
    if (!email.success) {
      throw new AuthError("google_unverified", "Google gave us an email address we can't use.");
    }
    const emailInUse = new AuthError(
      "email_in_use",
      "An account with this email already exists. Sign in with your password, then connect Google from your account page.",
    );
    if (await store.findByEmail(email.data)) {
      events.record({
        kind: "user",
        type: "google_refused",
        visitor,
        detail: "email already has an account",
      });
      throw emailInUse;
    }

    // From here on this would create an account, so the same gates as an ordinary sign-up apply.
    if (!ctx.adult) {
      throw new AuthError(
        "adult_required",
        "To create an account, tick the 18+ box on the Create account tab, then try again.",
      );
    }
    if (ctx.banned) throw new AuthError("banned", "You can't create an account right now.");
    if (!this.deps.limiter.take(`reg:${visitor}`, REGISTER_MAX, REGISTER_WINDOW_MS)) {
      throw new AuthError("too_many", "Too many sign-ups from this connection. Try again later.");
    }

    try {
      const user = await store.create({
        email: email.data,
        displayName: nameFromGoogle(profile.name, email.data),
        passwordHash: null,
        googleSub: profile.sub,
        signupRef: visitor,
      });
      events.record({ kind: "user", type: "google_register", visitor, detail: tag(user) });
      return { user, created: true };
    } catch (err) {
      if (!(err instanceof DuplicateGoogleError || err instanceof DuplicateEmailError)) throw err;
      // Someone got there first. If it was this same Google account (a double click, two tabs) they are
      // simply signed in to it; if it was somebody else using the email, that is the "email in use" case.
      const winner = await store.findByGoogleSub(profile.sub);
      if (winner) return { user: await this.googleLogin(winner, visitor), created: false };
      throw emailInUse;
    }
  }

  /** Connect a Google account to the account `user` is signed in to. */
  async linkGoogle(user: UserRecord, profile: GoogleProfile, visitor: string): Promise<UserRecord> {
    const { store, events } = this.deps;
    const other = await store.findByGoogleSub(profile.sub);
    if (other && other.id !== user.id) {
      throw new AuthError(
        "google_in_use",
        "That Google account is already connected to a different account here.",
      );
    }
    if (other) return user; // already connected to this account
    try {
      const updated = await store.setGoogleSub(user.id, profile.sub);
      events.record({ kind: "user", type: "google_linked", visitor, detail: tag(user) });
      return updated;
    } catch (err) {
      if (err instanceof DuplicateGoogleError) {
        throw new AuthError(
          "google_in_use",
          "That Google account is already connected to a different account here.",
        );
      }
      throw err;
    }
  }

  /** Disconnect Google. Only allowed once there is a password, so the person can still sign in. */
  async unlinkGoogle(user: UserRecord, visitor: string): Promise<UserRecord> {
    if (!user.googleSub) return user;
    if (!user.passwordHash) {
      throw new AuthError(
        "no_password",
        "Set a password first, so you can still sign in after disconnecting Google.",
      );
    }
    const updated = await this.deps.store.setGoogleSub(user.id, null);
    this.deps.events.record({ kind: "user", type: "google_unlinked", visitor, detail: tag(user) });
    return updated;
  }

  // ---------- the account itself ----------

  /**
   * Change the password, or set the first one for someone who signed up with Google (no current
   * password to give). Every other sign-in of this account ends; the returned account carries the new version.
   */
  async changePassword(
    user: UserRecord,
    current: string | undefined,
    next: string,
    visitor: string,
  ): Promise<UserRecord> {
    const hadPassword = Boolean(user.passwordHash);
    if (hadPassword) await this.confirmPassword(user, current ?? "");
    const updated = await this.deps.store.setPassword(user.id, await this.deps.hasher.hash(next));
    this.deps.events.record({
      kind: "user",
      type: hadPassword ? "password_changed" : "password_set",
      visitor,
      detail: tag(user),
    });
    return updated;
  }

  /** Confirm with the password, or (for someone with no password) by typing the account's email address. */
  async deleteAccount(
    user: UserRecord,
    confirm: { password?: string; email?: string },
    visitor: string,
  ): Promise<void> {
    if (user.passwordHash) {
      await this.confirmPassword(user, confirm.password ?? "");
    } else if ((confirm.email ?? "").trim().toLowerCase() !== user.email) {
      throw new AuthError("wrong_confirmation", "That isn't the email address on this account.");
    }
    await this.deps.store.delete(user.id);
    this.deps.events.record({ kind: "user", type: "account_deleted", visitor, detail: tag(user) });
  }

  /** Everything stored about an account, for the person who owns it. The password hash is not included. */
  exportData(user: UserRecord) {
    return {
      account: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        loginCount: user.loginCount,
        premiumUntil: user.premiumUntil?.toISOString() ?? null,
        hasPassword: user.passwordHash !== null,
        googleConnected: user.googleSub !== null,
      },
      note: "This is everything stored about your account. Chats are not stored.",
    };
  }

  publicUser(user: UserRecord): PublicUser {
    return {
      name: user.displayName,
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      hasPassword: user.passwordHash !== null,
      google: user.googleSub !== null,
    };
  }

  private async googleLogin(user: UserRecord, visitor: string): Promise<UserRecord> {
    if (user.disabledAt) {
      this.deps.events.record({
        kind: "user",
        type: "login_blocked",
        visitor,
        detail: `suspended ${tag(user)}`,
      });
      throw new AuthError("suspended", "This account is suspended. Contact the site operator.");
    }
    const updated = await this.deps.store.recordLogin(user.id);
    this.deps.events.record({ kind: "user", type: "google_login", visitor, detail: tag(user) });
    return updated;
  }

  /** Sensitive actions ask for the password again, and guessing it is limited too. */
  private async confirmPassword(user: UserRecord, password: string): Promise<void> {
    const { hasher, limiter } = this.deps;
    const key = `lf:a:${user.id}`;
    if (limiter.count(key, LOCKOUT_WINDOW_MS) >= SENSITIVE_MAX_PER_ACCOUNT) {
      throw new AuthError("too_many", "Too many attempts. Try again in a few minutes.");
    }
    if (!user.passwordHash || !(await hasher.verify(user.passwordHash, password))) {
      limiter.strike(key, LOCKOUT_WINDOW_MS);
      throw new AuthError("wrong_password", "That password isn't right.");
    }
  }

  /** A hash of a password nobody knows, made fresh for each run of the server. */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(randomBytes(24).toString("hex"));
    return this.dummyHash;
  }
}
