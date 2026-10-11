import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSiteConfig } from "../hooks/useSiteConfig.js";
import { loadAdSense } from "./adsense.js";
import { usePlus } from "./PlusContext.js";
import { useDesktop } from "./viewport.js";

/** If the ad script has said nothing after this long, the slot collapses. */
const GIVE_UP_MS = 12_000;

interface Props {
  /** Which place this is. Its AdSense ad unit ID comes from the site's settings. */
  slot: "profile" | "landing";
  /** The exact size to reserve, in pixels. The page does not move when the ad arrives. */
  width: number;
  height: number;
  /** Draw nothing below 1024px wide. */
  desktopOnly?: boolean;
}

/**
 * One advertising box: a small "ad" label on the left and "remove ads ✦" on the right above exactly the
 * reserved space. It draws nothing at all for Plus members, when ads are off, when there is no ad unit for
 * this place, in video chat, or (with desktopOnly) on narrow windows. If the ad can't load or has nothing to
 * show, the box and its label disappear.
 */
export function AdSlot({ slot, width, height, desktopOnly = false }: Props) {
  const { config } = useSiteConfig();
  const { adsVisible } = usePlus();
  const desktop = useDesktop();
  const { pathname } = useLocation();
  const [failed, setFailed] = useState(false);

  const client = config.ads.client;
  const unit = config.ads.slots[slot];
  const inVideo = pathname === "/video" || pathname.startsWith("/video/");
  if (!adsVisible || !client || !unit || failed || inVideo || (desktopOnly && !desktop))
    return null;

  return (
    <AdUnit
      client={client}
      unit={unit}
      width={width}
      height={height}
      refreshSeconds={config.ads.refreshSeconds}
      onFail={() => setFailed(true)}
    />
  );
}

interface UnitProps {
  client: string;
  unit: string;
  width: number;
  height: number;
  refreshSeconds: number;
  onFail(): void;
}

function AdUnit({ client, unit, width, height, refreshSeconds, onFail }: UnitProps) {
  const { openPlus } = usePlus();
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [round, setRound] = useState(0);
  const fail = useRef(onFail);
  useEffect(() => {
    fail.current = onFail;
  });

  // Lazy: nothing is requested until the box is about to scroll into view.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const watcher = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setNear(true),
      { rootMargin: "200px" },
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // Ask for the ad, and collapse if it can't be had.
  useEffect(() => {
    if (!near) return;
    let live = true;
    const ins = box.current?.querySelector("ins") ?? null;
    const watcher = new MutationObserver(() => {
      if (ins?.getAttribute("data-ad-status") === "unfilled") fail.current();
    });
    if (ins) watcher.observe(ins, { attributes: true, attributeFilter: ["data-ad-status"] });
    loadAdSense(client)
      .then(() => {
        if (!live) return;
        try {
          (window.adsbygoogle ??= []).push({});
        } catch {
          fail.current();
        }
      })
      .catch(() => live && fail.current());
    const giveUp = setTimeout(() => {
      if (live && ins && !ins.getAttribute("data-ad-status") && !ins.querySelector("iframe")) {
        fail.current();
      }
    }, GIVE_UP_MS);
    return () => {
      live = false;
      watcher.disconnect();
      clearTimeout(giveUp);
    };
  }, [near, round, client, unit]);

  // Optional refresh: never faster than once a minute, and only while the tab is in front. (AdSense's own rules
  // do not allow refreshing its units, so this is off unless the operator turns it on for another provider.)
  useEffect(() => {
    if (!near || refreshSeconds < 60) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRound((n) => n + 1);
    }, refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [near, refreshSeconds]);

  return (
    <aside className="ad" aria-label="Advertisement" style={{ width, maxWidth: "100%" }}>
      <div className="ad-head">
        <span className="ad-tag">ad</span>
        <button type="button" className="ad-remove" onClick={openPlus}>
          remove ads ✦
        </button>
      </div>
      <div className="ad-box" ref={box} style={{ width, height, maxWidth: "100%" }}>
        <ins
          key={round}
          className="adsbygoogle"
          style={{ display: "inline-block", width, height }}
          data-ad-client={client}
          data-ad-slot={unit}
        />
      </div>
    </aside>
  );
}
