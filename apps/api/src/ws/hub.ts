import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { parseClientMessage, type ServerMessage } from "@passerby/shared";
import { ChatEngine, type BanStore, type ReportSink } from "../chat/engine.js";
import type { Logger } from "../logger.js";

export interface Hub {
  /** People who have said hello (confirmed 18+) and are connected. */
  online(): number;
  engine: ChatEngine;
  close(): Promise<void>;
}

export interface HubOptions {
  server: Server;
  logger: Logger;
  bans: BanStore;
  reports: ReportSink;
  /** Turns an address into the scrambled visitor ID that bans and reports use. */
  visitorOf(address: string): string;
  /** Browsers may only connect from these origins (plus the server's own host). */
  allowedOrigins: string[];
  /** Turn video chat off for everyone. Default on. */
  videoEnabled?: boolean;
  path?: string;
}

interface Socket {
  ws: WebSocket;
  times: number[];
  alive: boolean;
  /** Messages from one connection are handled one after another, in the order they arrived. */
  queue: Promise<void>;
}

const MAX_MESSAGES = 90;
const WINDOW_MS = 3000;
const MAX_CONNECTIONS_PER_ADDRESS = 8;
const COUNT_DELAY_MS = 1500;

export function createHub({
  server,
  logger,
  bans,
  reports,
  visitorOf,
  allowedOrigins,
  videoEnabled = true,
  path = "/ws",
}: HubOptions): Hub {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const sockets = new Map<string, Socket>();
  const perAddress = new Map<string, number>();

  const send = (id: string, msg: ServerMessage) => {
    const s = sockets.get(id);
    if (s?.ws.readyState === WebSocket.OPEN) s.ws.send(JSON.stringify(msg));
  };

  let countTimer: NodeJS.Timeout | null = null;
  const pushCount = () => {
    if (countTimer) return;
    countTimer = setTimeout(() => {
      countTimer = null;
      const msg: ServerMessage = { t: "count", online: engine.online() };
      for (const id of engine.presentIds()) send(id, msg);
    }, COUNT_DELAY_MS);
  };

  const engine = new ChatEngine({
    transport: {
      send,
      close: (id, code, reason) => sockets.get(id)?.ws.close(code, reason),
    },
    bans,
    reports,
    videoEnabled,
    onPresence: pushCount,
    onError: (err, what) => logger.error({ err }, what),
  });

  const originOk = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser
    try {
      const host = new URL(origin).host;
      return host === req.headers.host || allowedOrigins.some((o) => new URL(o).host === host);
    } catch {
      return false;
    }
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) return; // some other handler's upgrade
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!originOk(req)) return reject("403 Forbidden");
    const address = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?")
      .split(",")[0]!
      .trim();
    if ((perAddress.get(address) ?? 0) >= MAX_CONNECTIONS_PER_ADDRESS)
      return reject("429 Too Many Requests");
    wss.handleUpgrade(req, socket, head, (ws) => {
      perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
      ws.once("close", () => {
        const left = (perAddress.get(address) ?? 1) - 1;
        if (left <= 0) perAddress.delete(address);
        else perAddress.set(address, left);
      });
      wss.emit("connection", ws, address);
    });
  });

  wss.on("connection", (ws: WebSocket, address: string) => {
    const id = randomUUID();
    const slot: Socket = { ws, times: [], alive: true, queue: Promise.resolve() };
    sockets.set(id, slot);
    engine.connect(id, visitorOf(address));
    ws.on("pong", () => (slot.alive = true));

    ws.on("message", (raw) => {
      const now = Date.now();
      slot.times = slot.times.filter((t) => now - t < WINDOW_MS);
      slot.times.push(now);
      if (slot.times.length > MAX_MESSAGES) {
        logger.warn("closing a connection that sent too many messages");
        return ws.close(4008, "too many messages");
      }
      const msg = parseClientMessage(raw.toString());
      if (!msg)
        return send(id, {
          t: "error",
          code: "invalid_message",
          text: "That message wasn't understood.",
        });
      slot.queue = slot.queue
        .then(() => engine.handle(id, msg))
        .catch((err) => logger.error({ err }, "failed to handle a message"));
    });

    ws.on("close", () => {
      // Let anything already queued finish first, so the end of the chat is handled in order.
      slot.queue = slot.queue.then(() => {
        engine.disconnect(id);
        sockets.delete(id);
      });
    });
    ws.on("error", (err) => logger.warn({ err }, "socket error"));
  });

  // Drop connections that stopped answering (closed laptop lid, lost network).
  const heartbeat = setInterval(() => {
    for (const slot of sockets.values()) {
      if (!slot.alive) {
        slot.ws.terminate();
        continue;
      }
      slot.alive = false;
      slot.ws.ping();
    }
  }, 30_000);

  return {
    online: () => engine.online(),
    engine,
    async close() {
      clearInterval(heartbeat);
      if (countTimer) clearTimeout(countTimer);
      for (const slot of sockets.values()) slot.ws.close(1001, "server restarting");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
