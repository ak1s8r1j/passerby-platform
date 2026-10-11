import { createServer } from "node:http";
import { VERSION, createApp } from "./app.js";
import { AdminData } from "./admin/data.js";
import { runRetention } from "./admin/retention.js";
import { createAdminRouter } from "./admin/routes.js";
import { loadConfig } from "./config.js";
import { prismaBans, prismaReports } from "./chat/stores.js";
import { GOOGLE_ENDPOINTS, GoogleOAuth } from "./auth/google.js";
import { Accounts } from "./auth/service.js";
import { Limiter } from "./auth/limiter.js";
import { argon2 } from "./auth/passwords.js";
import { createAuthRouter } from "./auth/routes.js";
import { prismaUsers } from "./auth/store.js";
import { createDb, dbHealth } from "./db.js";
import { prismaEvents } from "./events.js";
import { createLogger } from "./logger.js";
import { offlineCountryLookup } from "./geo.js";
import { HourlyStats } from "./stats.js";
import { visitorId } from "./visitor.js";
import { createHub } from "./ws/hub.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);
const startedAt = Date.now();

const server = createServer();
const bans = prismaBans(db);
const users = prismaUsers(db);
const events = prismaEvents(db, logger);
const stats = new HourlyStats();
const visitorOf = (address: string) => visitorId(address, config.SESSION_SECRET);
const accounts = new Accounts({
  store: users,
  hasher: argon2,
  events,
  limiter: new Limiter(),
});

const hub = createHub({
  server,
  logger,
  bans,
  reports: prismaReports(db),
  visitorOf,
  allowedOrigins: [config.PUBLIC_URL],
  videoEnabled: config.VIDEO_ENABLED,
  countryOf: offlineCountryLookup(),
  stats,
  events,
});
// "Continue with Google" is on only when both settings are given. The URL overrides exist for testing
// against a stand-in for Google.
const google =
  config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ? new GoogleOAuth({
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        redirectUri: `${config.PUBLIC_URL.replace(/\/$/, "")}/api/v1/auth/google/callback`,
        endpoints: {
          authUrl: config.GOOGLE_AUTH_URL ?? GOOGLE_ENDPOINTS.authUrl,
          tokenUrl: config.GOOGLE_TOKEN_URL ?? GOOGLE_ENDPOINTS.tokenUrl,
          jwksUrl: config.GOOGLE_JWKS_URL ?? GOOGLE_ENDPOINTS.jwksUrl,
          issuers: config.GOOGLE_ISSUER ? [config.GOOGLE_ISSUER] : GOOGLE_ENDPOINTS.issuers,
        },
      })
    : undefined;

const auth = createAuthRouter({
  accounts,
  store: users,
  bans,
  secret: config.SESSION_SECRET,
  visitorOf,
  publicUrl: config.PUBLIC_URL,
  google,
  onProblem: (err, what) => {
    logger.warn({ err }, what);
    events.record({ kind: "system", type: "warning", detail: what });
  },
});

const admin = createAdminRouter({
  credentials: config.ADMIN_KEY ? { user: config.ADMIN_USER, key: config.ADMIN_KEY } : null,
  secret: config.SESSION_SECRET,
  publicUrl: config.PUBLIC_URL,
  visitorOf,
  data: new AdminData(db, argon2),
  live: () => hub.engine.snapshot(),
  ban: (visitor, hours, reason) => hub.engine.ban(visitor, hours, reason, "admin"),
  events,
  health: dbHealth(db),
  startedAt,
  info: {
    version: VERSION,
    siteName: config.SITE_NAME,
    publicUrl: config.PUBLIC_URL,
    video: config.VIDEO_ENABLED,
    googleSignIn: Boolean(google),
    turn: Boolean(config.TURN_URL),
    contact: Boolean(config.CONTACT_EMAIL),
    environment: config.NODE_ENV,
    eventDays: config.EVENT_RETENTION_DAYS,
    reportDays: config.REPORT_RETENTION_DAYS,
  },
});
if (!config.ADMIN_KEY) logger.info("ADMIN_KEY is not set, so the admin area is switched off");

const app = createApp({
  config,
  logger,
  health: dbHealth(db),
  online: hub.online,
  auth,
  admin,
  onServerError: (err) =>
    events.record({
      kind: "system",
      type: "error",
      detail: `a request failed (${err instanceof Error ? err.name : "unknown"})`,
    }),
});
server.on("request", app);

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.fatal(
      `Port ${config.PORT} is already in use. Another copy of this app (or a different program) is running there. Stop it, or set a different PORT.`,
    );
  } else {
    logger.fatal({ err }, "the server could not start");
  }
  process.exit(1);
});

server.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "api is listening");
  events.record({ kind: "system", type: "startup", detail: `version ${VERSION}` });
});

// Write the dashboard's counters to the database every half minute.
const flushStats = () =>
  stats.flush(db).catch((err) => logger.warn({ err }, "could not save the dashboard counters"));
const statsTimer = setInterval(() => void flushStats(), 30_000);

// Delete what is past its keep-until date: once soon after start-up, then every six hours.
const retain = async () => {
  try {
    const gone = await runRetention(db, {
      eventDays: config.EVENT_RETENTION_DAYS,
      reportDays: config.REPORT_RETENTION_DAYS,
    });
    const total = gone.events + gone.reports + gone.stats + gone.bans;
    if (total > 0) {
      logger.info(gone, "removed old data");
      events.record({
        kind: "system",
        type: "retention",
        detail: `removed ${gone.events} log lines, ${gone.reports} reports, ${gone.bans} old bans`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "could not remove old data");
  }
};
const firstRetention = setTimeout(() => void retain(), 60_000);
const retentionTimer = setInterval(() => void retain(), 6 * 3_600_000);
for (const t of [statsTimer, firstRetention, retentionTimer]) t.unref();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await hub.close();
  await flushStats();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => {
  logger.error({ err }, "unhandled rejection");
  events.record({ kind: "system", type: "error", detail: "an unhandled promise rejection" });
});
