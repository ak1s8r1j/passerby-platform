import { vi } from "vitest";
import type { SiteConfig } from "@passerby/shared";
import { resetSiteConfig } from "../hooks/useSiteConfig.js";

export const STUN = { urls: "stun:stun.l.google.com:19302" };
export const TURN = { urls: "turn:relay.example:3478", username: "u", credential: "p" };

/**
 * Fake the two API calls the pages make: the live count and the site config.
 * `config: "down"` makes the config call fail, like an unreachable server.
 */
export function stubApi(options: { online?: number; config?: SiteConfig | "down" } = {}) {
  resetSiteConfig();
  const config = options.config ?? { video: true, iceServers: [STUN, TURN] };
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    if (path.endsWith("/api/v1/config")) {
      return config === "down"
        ? new Response("nope", { status: 503 })
        : new Response(JSON.stringify(config), { status: 200 });
    }
    return new Response(JSON.stringify({ online: options.online ?? 3 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}
