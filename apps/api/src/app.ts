import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import { rateLimit } from "express-rate-limit";
import type { Router } from "express";
import helmet from "helmet";
import type { ErrorResponse, HealthResponse, SiteConfig, StatsResponse } from "@passerby/shared";
import { adsConfig, iceServers, type Config } from "./config.js";
import type { Health } from "./db.js";
import type { Logger } from "./logger.js";

export const VERSION = "0.1.0";

export interface AppDeps {
  config: Config;
  logger: Logger;
  health: Health;
  /** How many people are connected right now. */
  online(): number;
  /** Sign-up, sign-in and account settings, mounted at /api/v1/auth. Left out in tests that do not need accounts. */
  auth?: Router;
  /** The owner's admin area, mounted at /api/v1/admin. */
  admin?: Router;
  /** Called when a request fails for a reason that is our fault (so it can go in the activity log). */
  onServerError?: (err: unknown) => void;
}

const apiError = (code: string, message: string): ErrorResponse => ({ error: { code, message } });

/** What Google's AdSense needs the page to allow (from Google's own guidance for content security policies). */
const ADSENSE_SOURCES = {
  script: [
    "https://pagead2.googlesyndication.com",
    "https://partner.googleadservices.com",
    "https://tpc.googlesyndication.com",
    "https://www.googletagservices.com",
    "https://adservice.google.com",
    "https://securepubads.g.doubleclick.net",
  ],
  frame: [
    "https://googleads.g.doubleclick.net",
    "https://tpc.googlesyndication.com",
    "https://www.google.com",
    "https://*.safeframe.googlesyndication.com",
  ],
  img: [
    "https://pagead2.googlesyndication.com",
    "https://tpc.googlesyndication.com",
    "https://www.google.com",
    "https://*.g.doubleclick.net",
  ],
  connect: [
    "https://pagead2.googlesyndication.com",
    "https://*.g.doubleclick.net",
    "https://www.google.com",
  ],
};

export function createApp({
  config,
  logger,
  health,
  online,
  auth,
  admin,
  onServerError,
}: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  // Railway and most hosts sit behind one proxy. This makes req.ip the visitor, not the proxy.
  app.set("trust proxy", 1);

  // AdSense can only run if the page lets Google's ad scripts, frames and pictures in. That is opened up only
  // when AdSense is set up (a publisher ID is given and ads are switched on); otherwise the policy stays strict.
  const adSense = config.ADS_ENABLED && Boolean(config.ADSENSE_CLIENT);
  const google = adSense ? ADSENSE_SOURCES : null;
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "connect-src": ["'self'", "ws:", "wss:", ...(google?.connect ?? [])],
          "script-src": ["'self'", ...(google?.script ?? [])],
          "frame-src": ["'self'", ...(google?.frame ?? [])],
          "img-src": ["'self'", "data:", ...(google?.img ?? [])],
          // AdSense styles its box with an inline style, which a strict policy refuses.
          "style-src": ["'self'", ...(google ? ["'unsafe-inline'"] : [])],
          "font-src": ["'self'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const path = req.originalUrl.split("?")[0];
      if (path !== "/healthz") {
        logger.info(
          { method: req.method, path, status: res.statusCode, ms: Date.now() - start },
          "request",
        );
      }
    });
    next();
  });

  // Tells ad buyers who is allowed to sell this site's ads. Only served when AdSense is set up.
  app.get("/ads.txt", (_req, res) => {
    if (!adSense || !config.ADSENSE_CLIENT) return void res.status(404).type("text/plain").send("");
    const publisher = config.ADSENSE_CLIENT.replace(/^ca-/, "");
    res.type("text/plain").send(`google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`);
  });

  app.get("/healthz", async (_req, res) => {
    const up = await health.ping();
    const body: HealthResponse = { ok: up, version: VERSION, database: up ? "up" : "down" };
    res.status(up ? 200 : 503).json(body);
  });

  const api = express.Router();
  api.use(
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }),
  );
  api.get("/stats", (_req, res) => {
    const body: StatsResponse = { online: online() };
    res.json(body);
  });
  api.get("/config", (_req, res) => {
    const body: SiteConfig = {
      video: config.VIDEO_ENABLED,
      iceServers: iceServers(config),
      name: config.SITE_NAME,
      contact: config.CONTACT_EMAIL ?? null,
      accountLink: config.ACCOUNT_LINK,
      googleSignIn: Boolean(config.GOOGLE_CLIENT_ID),
      ads: adsConfig(config),
      plusFilters: config.PLUS_FILTERS,
      plusCheckout: config.PLUS_CHECKOUT,
    };
    res.json(body);
  });
  if (auth) api.use("/auth", auth);
  if (admin) api.use("/admin", admin);
  api.use((_req, res) => {
    res.status(404).json(apiError("not_found", "There is no such API route."));
  });
  app.use("/api/v1", api);

  // In production the API also serves the built web app, so one service is enough.
  // Express needs an absolute path to send a file, but settings are easier to write as relative ones.
  const dist = config.WEB_DIST ? resolve(config.WEB_DIST) : undefined;
  if (dist && existsSync(join(dist, "index.html"))) {
    app.use(
      "/assets",
      express.static(join(dist, "assets"), { immutable: true, maxAge: "1y", fallthrough: false }),
    );
    app.use(express.static(dist, { index: false, maxAge: "5m" }));
    // With AdSense set up, the page itself carries Google's script tag, so Google's crawler (which does not run
    // the site's own code) can find it when it verifies ownership. Video chat and the admin area get the plain
    // page: nothing from Google is ever part of them.
    const shell = readFileSync(join(dist, "index.html"), "utf8");
    const withAdSense =
      adSense && config.ADSENSE_CLIENT
        ? shell.replace(
            "</head>",
            `    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${config.ADSENSE_CLIENT}" crossorigin="anonymous"></script>\n  </head>`,
          )
        : shell;
    const adFree = (path: string) =>
      path === "/video" ||
      path.startsWith("/video/") ||
      path === "/admin" ||
      path.startsWith("/admin/");
    app.get(/^(?!\/(api|ws)\b).*/, (req, res) => {
      // The admin pages are for the owner alone: keep them out of search engines.
      if (req.path === "/admin" || req.path.startsWith("/admin/")) {
        res.setHeader("x-robots-tag", "noindex, nofollow");
      }
      res.type("html").send(adFree(req.path) ? shell : withAdSense);
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Mistakes by the caller (bad JSON, body too large) carry a 4xx status; everything else is our fault.
    const status = Number(err?.status ?? err?.statusCode);
    if (status >= 400 && status < 500) {
      const code = status === 413 ? "too_large" : "bad_request";
      const message =
        status === 413 ? "That request is too large." : "That request couldn't be understood.";
      return void res.status(status).json(apiError(code, message));
    }
    logger.error({ err }, "unhandled error");
    onServerError?.(err);
    res.status(500).json(apiError("internal", "Something went wrong."));
  };
  app.use(onError);

  return app;
}
