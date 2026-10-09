import { useCallback, useEffect, useRef } from "react";

/**
 * When something happens while this tab is in the background, show a count in the tab title
 * ("(2) Passerby…") so the visitor notices. It clears when they come back.
 */
export function useUnreadTitle(): () => void {
  /** The real title, remembered only while a count is showing. */
  const real = useRef<string | null>(null);
  const unread = useRef(0);

  const clear = useCallback(() => {
    if (real.current !== null) document.title = real.current;
    real.current = null;
    unread.current = 0;
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) clear();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clear();
    };
  }, [clear]);

  return useCallback(() => {
    if (!document.hidden) return;
    // Read the title now, not when the page opened: it may have been set since.
    real.current ??= document.title;
    unread.current++;
    document.title = `(${unread.current}) ${real.current}`;
  }, []);
}
