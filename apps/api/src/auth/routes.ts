import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import {
  ChangePasswordRequest,
  DeleteAccountRequest,
  LoginRequest,
  RegisterRequest,
  type ErrorResponse,
  type MeResponse,
} from "@passerby/shared";
import type { BanStore } from "../chat/engine.js";
import { GoogleError, newPkce, type GoogleSignIn } from "./google.js";
import { openState, OAUTH_COOKIE, OAUTH_MS, sealState } from "./oauth-state.js";
import { AuthError, type Accounts, type AuthErrorCode } from "./service.js";
import {
  cookieValue,
  createSessionToken,
  readSessionToken,
  SESSION_COOKIE,
  SESSION_MS,
} from "./session.js";
import type { UserRecord, UserStore } from "./store.js";

export interface AuthRouterDeps {
  accounts: Accounts;
  store: UserStore;
  bans: BanStore;
  /** Signs the sign-in cookie. */
  secret: string;
  /** Turns an address into the scrambled visitor ID. */
  visitorOf(address: string): string;
  /** The site's public address; requests from it are accepted as same-origin. */
  publicUrl: string;
  /** "Continue with Google". Leave out to switch it off: its routes then answer "not found". */
  google?: GoogleSignIn;
  /** Notes problems (a failed Google login) for the server log. */
  onProblem?: (err: unknown, what: string) => void;
}

const STATUS: Record<AuthErrorCode, number> = {
  wrong_confirmation: 400,
  google_unverified: 403,
  email_in_use: 409,
  adult_required: 400,
  banned: 403,
  google_in_use: 409,
  no_password: 400,
  duplicate_email: 409,
  bad_credentials: 401,
  wrong_password: 401,
  suspended: 403,
  too_many: 429,
};

const fail = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

/** Sign-up, sign-in, sign-out and the account's own settings. Mounted at /api/v1/auth. */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { accounts, store, bans } = deps;
  const router = Router();
  const publicHost = new URL(deps.publicUrl).host;

  // Account responses are personal: no browser or proxy should keep a copy.
  router.use((_req, res, next) => {
    res.setHeader("cache-control", "no-store");
    next();
  });

  // A browser sends Origin with every POST. A request from another website is refused, so a page on
  // some other site cannot make a visitor's browser change their account.
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    if (req.method !== "POST" || !origin) return next();
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      // unreadable origin: refused below
    }
    if (host === req.headers.host || host === publicHost) return next();
    res.status(403).json(fail("bad_origin", "That request came from another website."));
  });

  const visitor = (req: Request) => deps.visitorOf(req.ip ?? "?");

  /** The signed-in account, or null. A cookie only counts while its version matches and the account is not suspended. */
  async function current(req: Request): Promise<UserRecord | null> {
    const session = readSessionToken(deps.secret, cookieValue(req.headers.cookie, SESSION_COOKIE));
    if (!session) return null;
    const user = await store.findById(session.id);
    if (!user || user.disabledAt || user.sessionVersion !== session.version) return null;
    return user;
  }

  const startSession = (req: Request, res: Response, user: UserRecord) =>
    res.cookie(SESSION_COOKIE, createSessionToken(deps.secret, user), {
      httpOnly: true, // scripts on the page can never read it
      sameSite: "lax",
      secure: req.secure, // https only, wherever the site is served over https
      maxAge: SESSION_MS,
      path: "/",
    });
  const endSession = (req: Request, res: Response) =>
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      sameSite: "lax",
      secure: req.secure,
      path: "/",
    });

  /** Turns an AuthError into the right response, and lets anything else reach the generic handler. */
  const handle =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    async (req, res, next) => {
      try {
        await fn(req, res);
      } catch (err) {
        if (err instanceof AuthError) {
          res.status(STATUS[err.code]).json(fail(err.code, err.message));
        } else {
          next(err);
        }
      }
    };

  /** Parse a request body, or answer 400 with the first problem in words. */
  function body<T>(
    schema: {
      safeParse(
        v: unknown,
      ): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } };
    },
    req: Request,
    res: Response,
  ): T | null {
    const parsed = schema.safeParse(req.body);
    if (parsed.success) return parsed.data;
    res
      .status(400)
      .json(
        fail("invalid", parsed.error.issues[0]?.message ?? "That request couldn't be understood."),
      );
    return null;
  }

  const signInFirst = (res: Response) =>
    res.status(401).json(fail("not_signed_in", "Sign in first."));

  router.get(
    "/me",
    handle(async (req, res) => {
      const user = await current(req);
      const out: MeResponse = { user: user ? accounts.publicUser(user) : null };
      res.json(out);
    }),
  );

  router.post(
    "/register",
    handle(async (req, res) => {
      const input = body(RegisterRequest, req, res);
      if (!input) return;
      if (await bans.get(visitor(req))) {
        return res.status(403).json(fail("banned", "You can't create an account right now."));
      }
      const user = await accounts.register(input, visitor(req));
      startSession(req, res, user);
      const out: MeResponse = { user: accounts.publicUser(user) };
      res.json(out);
    }),
  );

  router.post(
    "/login",
    handle(async (req, res) => {
      const input = body(LoginRequest, req, res);
      if (!input) return;
      const user = await accounts.login(input.email, input.password, visitor(req));
      startSession(req, res, user);
      const out: MeResponse = { user: accounts.publicUser(user) };
      res.json(out);
    }),
  );

  router.post(
    "/logout",
    handle(async (req, res) => {
      endSession(req, res);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/password",
    handle(async (req, res) => {
      const user = await current(req);
      if (!user) return signInFirst(res);
      const input = body(ChangePasswordRequest, req, res);
      if (!input) return;
      const updated = await accounts.changePassword(user, input.password, input.next, visitor(req));
      startSession(req, res, updated); // this browser stays signed in; every other sign-in has just ended
      res.json({ ok: true });
    }),
  );

  router.post(
    "/delete",
    handle(async (req, res) => {
      const user = await current(req);
      if (!user) return signInFirst(res);
      const input = body(DeleteAccountRequest, req, res);
      if (!input) return;
      await accounts.deleteAccount(user, input, visitor(req));
      endSession(req, res);
      res.json({ ok: true });
    }),
  );

  router.get(
    "/export",
    handle(async (req, res) => {
      const user = await current(req);
      if (!user) return signInFirst(res);
      res.setHeader("content-disposition", 'attachment; filename="my-data.json"');
      res.type("json").send(JSON.stringify(accounts.exportData(user), null, 2));
    }),
  );

  // ---------- "Continue with Google" ----------
  // The visitor is sent to Google and comes back to /google/callback. Every result is shown on the
  // account page, so these two routes always end by redirecting there with a short result code
  // (never a message, so nobody can make our page say something of their choosing).

  const google = deps.google;
  const notSetUp = (res: Response) =>
    res.status(404).json(fail("not_found", "Google sign-in isn't set up on this site."));
  const back = (res: Response, result: string) =>
    res.redirect(302, `/account?google=${encodeURIComponent(result)}`);
  const oauthCookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: "lax" as const, // Lax, not Strict: the cookie must come along when Google sends the visitor back
    secure: req.secure,
    path: "/api/v1/auth/google",
  });

  router.get(
    "/google/start",
    handle(async (req, res) => {
      if (!google) return notSetUp(res);
      accounts.googleAttempt(visitor(req));
      let link = "";
      if (req.query.link === "1") {
        const user = await current(req);
        if (!user) return back(res, "not_signed_in");
        link = user.id;
      }
      const state = randomBytes(18).toString("base64url");
      const nonce = randomBytes(18).toString("base64url");
      const { verifier, challenge } = newPkce();
      res.cookie(
        OAUTH_COOKIE,
        sealState(deps.secret, {
          state,
          nonce,
          verifier,
          adult: req.query.adult === "1",
          link,
          exp: Date.now() + OAUTH_MS,
        }),
        { ...oauthCookieOptions(req), maxAge: OAUTH_MS },
      );
      res.redirect(302, google.authorizeUrl({ state, nonce, challenge }));
    }),
  );

  router.get(
    "/google/callback",
    handle(async (req, res) => {
      if (!google) return notSetUp(res);
      const saved = openState(deps.secret, cookieValue(req.headers.cookie, OAUTH_COOKIE));
      res.clearCookie(OAUTH_COOKIE, oauthCookieOptions(req)); // good for one return trip only, whatever happens next
      const query = (name: string) =>
        typeof req.query[name] === "string" ? (req.query[name] as string) : "";

      if (query("error"))
        return back(res, query("error") === "access_denied" ? "cancelled" : "failed");
      // The `state` we sent must come back exactly: otherwise this return trip was not started by this browser.
      const state = query("state");
      if (
        !saved ||
        !state ||
        state.length !== saved.state.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))
      ) {
        return back(res, "expired");
      }
      const code = query("code");
      if (!code) return back(res, "failed");

      try {
        accounts.googleAttempt(visitor(req));
        const profile = await google.profileFor({
          code,
          verifier: saved.verifier,
          nonce: saved.nonce,
        });

        if (saved.link) {
          const user = await current(req);
          if (!user || user.id !== saved.link) return back(res, "expired"); // signed out, or someone else, in between
          await accounts.linkGoogle(user, profile, visitor(req));
          return back(res, "linked");
        }

        const banned = Boolean(await bans.get(visitor(req)));
        const { user, created } = await accounts.googleSignIn(profile, {
          visitor: visitor(req),
          adult: saved.adult,
          banned,
        });
        startSession(req, res, user);
        return back(res, created ? "created" : "ok");
      } catch (err) {
        if (err instanceof AuthError) return back(res, err.code);
        if (err instanceof GoogleError) {
          deps.onProblem?.(err, `google sign-in failed (${err.reason}): ${err.message}`);
          return back(res, "failed");
        }
        // Something on our side broke (say, the database is down or not migrated). The visitor is
        // mid-trip in their browser, so send them to the account page with a plain message instead of
        // a bare error page, and log it for the operator.
        deps.onProblem?.(err, `google sign-in hit an unexpected error: ${(err as Error).message}`);
        return back(res, "failed");
      }
    }),
  );

  router.post(
    "/google/unlink",
    handle(async (req, res) => {
      const user = await current(req);
      if (!user) return signInFirst(res);
      await accounts.unlinkGoogle(user, visitor(req));
      res.json({ ok: true });
    }),
  );

  return router;
}
