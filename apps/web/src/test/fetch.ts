import { vi } from "vitest";
import type { SiteConfig } from "@passerby/shared";
import { resetSiteConfig } from "../hooks/useSiteConfig.js";
import { FakeAccounts } from "./fake-accounts.js";

export const STUN = { urls: "stun:stun.l.google.com:19302" };
export const TURN = { urls: "turn:relay.example:3478", username: "u", credential: "p" };

/**
 * Fake the API calls the pages make: the live count, the site config, and accounts.
 * `config: "down"` makes the config call fail, like an unreachable server.
 */
export function stubApi(
  options: {
    online?: number;
    config?: Partial<SiteConfig> | "down";
    accounts?: FakeAccounts;
  } = {},
) {
  resetSiteConfig();
  const accounts = options.accounts ?? new FakeAccounts();
  const config: SiteConfig | "down" =
    options.config === "down"
      ? "down"
      : {
          video: true,
          iceServers: [STUN, TURN],
          name: "Passerby",
          contact: null,
          googleSignIn: false,
          ...options.config,
        };
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/api/v1/auth/")) return accounts.handle(path, init);
    if (path.endsWith("/api/v1/config")) {
      return config === "down"
        ? new Response("nope", { status: 503 })
        : new Response(JSON.stringify(config), { status: 200 });
    }
    return new Response(JSON.stringify({ online: options.online ?? 3 }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchFn);
  return { fetch: fetchFn, accounts };
}
