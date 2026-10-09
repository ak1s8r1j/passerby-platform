import { useEffect, useState } from "react";
import { SiteConfig } from "@passerby/shared";

/** Used until the server answers, and if it never does: video on, with the free STUN server. */
export const FALLBACK_CONFIG: SiteConfig = {
  video: true,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let cached: Promise<SiteConfig> | null = null;

/** Ask the server once per page load what is switched on and which servers video should use. */
function loadSiteConfig(): Promise<SiteConfig> {
  cached ??= fetch("/api/v1/config")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => SiteConfig.parse(data))
    .catch(() => {
      cached = null; // try again next time someone asks
      return FALLBACK_CONFIG;
    });
  return cached;
}

/** For tests: forget what was fetched. */
export function resetSiteConfig() {
  cached = null;
}

export function useSiteConfig(): { ready: boolean; config: SiteConfig } {
  const [state, setState] = useState<{ ready: boolean; config: SiteConfig }>({
    ready: false,
    config: FALLBACK_CONFIG,
  });
  useEffect(() => {
    let live = true;
    void loadSiteConfig().then((config) => live && setState({ ready: true, config }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
