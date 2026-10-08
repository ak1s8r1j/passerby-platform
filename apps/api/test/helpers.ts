import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { pino } from "pino";
import { createApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { createHub, type Hub } from "../src/ws/hub.js";
import { MemoryBans, MemoryReports } from "./chat-helpers.js";

export const silent = pino({ level: "silent" });

export const testConfig = (over: Record<string, string> = {}): Config =>
  loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused",
    SESSION_SECRET: "test-secret-test-secret",
    PUBLIC_URL: "http://localhost:5173",
    ...over,
  });

export interface TestServer {
  server: Server;
  hub: Hub;
  bans: MemoryBans;
  reports: MemoryReports;
  url: string;
  wsUrl: string;
  close(): Promise<void>;
}

/** A real HTTP + WebSocket server on a random port, with the database replaced by a stand-in. */
export async function startServer(dbUp = true): Promise<TestServer> {
  const config = testConfig();
  const server = createServer();
  const bans = new MemoryBans();
  const reports = new MemoryReports();
  const hub = createHub({
    server,
    logger: silent,
    bans,
    reports,
    // Every test connection comes from the same address, so give each its own visitor
    // unless a test wants to share one (it can, by connecting with the same ?visitor=).
    visitorOf: (address) => address,
    allowedOrigins: [config.PUBLIC_URL],
  });
  const app = createApp({
    config,
    logger: silent,
    health: { ping: async () => dbUp },
    online: hub.online,
  });
  server.on("request", app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    hub,
    bans,
    reports,
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    async close() {
      await hub.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
