declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** How long to wait for Google's script before giving up and collapsing the slot. */
const SCRIPT_TIMEOUT_MS = 10_000;

let loading: Promise<void> | null = null;

/** Whether Google's ad script has been asked for on this page. */
export const adsenseRequested = () => loading !== null;

/**
 * Load Google's ad script once, only when a slot is about to be seen. It is never part of the page's own
 * code, so it cannot hold up the chat, the camera or the connection. Rejects if it is blocked or slow.
 */
export function loadAdSense(client: string): Promise<void> {
  if (loading) return loading;
  const attempt = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    const timer = setTimeout(() => reject(new Error("ad script timed out")), SCRIPT_TIMEOUT_MS);
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error("ad script blocked"));
    };
    document.head.appendChild(script);
  });
  loading = attempt;
  // A failure is remembered for this page load only; the next page load tries again.
  attempt.catch(() => undefined);
  return attempt;
}

/** For tests: forget the script was requested. */
export function resetAdSense() {
  loading = null;
}
