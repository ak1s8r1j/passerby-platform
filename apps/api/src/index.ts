import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { prismaBans, prismaReports } from "./chat/stores.js";
import { createDb, dbHealth } from "./db.js";
import { createLogger } from "./logger.js";
import { visitorId } from "./visitor.js";
import { createHub } from "./ws/hub.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const db = createDb(config.DATABASE_URL);

const server = createServer();
const hub = createHub({
  server,
  logger,
  bans: prismaBans(db),
  reports: prismaReports(db),
  visitorOf: (address) => visitorId(address, config.SESSION_SECRET),
  allowedOrigins: [config.PUBLIC_URL],
  videoEnabled: config.VIDEO_ENABLED,
});
const app = createApp({ config, logger, health: dbHealth(db), online: hub.online });
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
