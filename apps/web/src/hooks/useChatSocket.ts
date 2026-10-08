import { useCallback, useEffect, useRef, useState } from "react";
import { ServerMessage, type ClientMessage } from "@passerby/shared";

export type SocketStatus = "idle" | "connecting" | "ready" | "reconnecting" | "closed";

/** Wait 1s, 2s, 4s ... up to 15s between attempts. Exported so tests can reason about it. */
export const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000);

export interface SocketOptions {
  /** Connect only when true (after the 18+ confirmation). */
  enabled: boolean;
  /** Builds the first message, sent every time the connection opens. */
  hello(): ClientMessage;
  /** Every valid message from the server. */
  onMessage(msg: ServerMessage): void;
  /** The connection was lost. The hook reconnects by itself, but whatever was in progress is gone. */
  onDrop(): void;
}

/**
 * Keeps the chat connection open: connects, says hello, and if the connection drops
 * (server restarting, network blip) retries by itself with a growing delay.
 */
export function useChatSocket(options: SocketOptions) {
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [online, setOnline] = useState<number | null>(null);
  const ws = useRef<WebSocket | null>(null);

  // Always call the latest handlers without reconnecting every time they change.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  const { enabled } = options;
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // The server removed this visitor: retrying would only be turned away again.
    let removed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;

    const open = () => {
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${proto}//${location.host}/ws`);
      ws.current = socket;

      socket.onopen = () => socket.send(JSON.stringify(latest.current.hello()));
      socket.onmessage = (e) => {
        let data: unknown;
        try {
          data = JSON.parse(String(e.data));
        } catch {
          return;
        }
        const parsed = ServerMessage.safeParse(data);
        if (!parsed.success) return;
        const msg = parsed.data;
        if (msg.t === "ready") {
          attempt = 0; // a good connection resets the back-off
          setStatus("ready");
          setOnline(msg.online);
        } else if (msg.t === "count") {
          setOnline(msg.online);
        } else if (msg.t === "banned") {
          removed = true;
        }
        latest.current.onMessage(msg);
      };
      socket.onclose = () => {
        if (stopped) return;
        clearInterval(keepAlive);
        if (removed) {
          setStatus("closed");
          return;
        }
        setStatus("reconnecting");
        latest.current.onDrop();
        retry = setTimeout(open, retryDelay(attempt++));
      };

      clearInterval(keepAlive);
      keepAlive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ t: "ping" } satisfies ClientMessage));
      }, 25_000);
    };

    open();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(keepAlive);
      ws.current?.close();
      ws.current = null;
    };
  }, [enabled]);

  const send = useCallback((m: ClientMessage) => {
    const socket = ws.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  }, []);

  return { status, online, send };
}
