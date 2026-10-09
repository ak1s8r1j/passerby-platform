import { createServer } from "node:http";
import { createApp } from "./app.js";
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
import { visitorId } from "./visitor.js";
import { createHub } from "./ws/hub.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);

const server = createServer();
const bans = prismaBans(db);
const users = prismaUsers(db);
const visitorOf = (address: string) => visitorId(address, config.SESSION_SECRET);
const accounts = new Accounts({
  store: users,
  hasher: argon2,
  events: prismaEvents(db, logger),
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
  onProblem: (err, what) => logger.warn({ err }, what),
});
const app = createApp({ config, logger, health: dbHealth(db), online: hub.online, auth });
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

server.listen(config.PORT, () =>
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "api is listening"),
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await hub.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
