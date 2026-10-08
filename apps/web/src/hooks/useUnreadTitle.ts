import { useCallback, useEffect, useRef } from "react";

/**
 * When something happens while this tab is in the background, show a count in the tab title
 * ("(2) Passerby…") so the visitor notices. It clears when they come back.
 */
export function useUnreadTitle(): () => void {
  const base = useRef(document.title);
  const unread = useRef(0);

  useEffect(() => {
    const original = base.current;
    const reset = () => {
      if (document.hidden) return;
      unread.current = 0;
      document.title = original;
    };
    document.addEventListener("visibilitychange", reset);
    return () => {
      document.removeEventListener("visibilitychange", reset);
      document.title = original;
    };
  }, []);

  return useCallback(() => {
    if (!document.hidden) return;
    unread.current++;
    document.title = `(${unread.current}) ${base.current}`;
  }, []);
}
