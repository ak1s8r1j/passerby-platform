import { useEffect, useState } from "react";
import { getStats } from "../api.js";

/** How many people are here now. Refreshes every 15 seconds; null until the first answer. */
export function useLiveCount(everyMs = 15_000): number | null {
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      getStats(ctl.signal)
        .then((s) => setOnline(s.online))
        .catch(() => undefined); // stay quiet; the count is nice to have, not essential
    load();
    const id = setInterval(load, everyMs);
    return () => {
      ctl.abort();
      clearInterval(id);
    };
  }, [everyMs]);
  return online;
}
