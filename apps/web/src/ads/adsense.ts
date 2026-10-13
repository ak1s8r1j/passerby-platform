declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** How long to wait for Google's script before giving up and collapsing the slot. */
const SCRIPT_TIMEOUT_MS = 10_000;

let loading: Promise<void> | null = null;

const SCRIPT = 'script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]';

/** Whether Google's ad script is on this page: asked for by a slot, or already in the page's own HTML. */
export const adsenseRequested = () => loading !== null || document.querySelector(SCRIPT) !== null;

/**
 * Load Google's ad script once, only when a slot is about to be seen. It is never part of the page's own
 * code, so it cannot hold up the chat, the camera or the connection. Rejects if it is blocked or slow.
 */
export function loadAdSense(client: string): Promise<void> {
  if (loading) return loading;
  // The server put the tag in the page: don't add a second one (Google refuses to load twice). Asks made
  // before it has loaded are queued by Google's own array and filled when it arrives; if it never comes
  // (blocked), the slot's own give-up timer collapses the box.
  if (document.querySelector(SCRIPT)) {
    loading = Promise.resolve();
    return loading;
  }
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
