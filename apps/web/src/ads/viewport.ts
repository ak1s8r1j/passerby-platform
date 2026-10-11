import { useEffect, useState } from "react";

/** Desktop means 1024px and wider. Anything narrower (including 768 to 1023) uses the mobile sizes. */
export const DESKTOP_QUERY = "(min-width: 1024px)";

const media = (query: string) =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query)
    : null;

/** Whether the window is desktop-wide right now, updating as it is resized. False where it can't be told. */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => media(DESKTOP_QUERY)?.matches ?? false);
  useEffect(() => {
    const m = media(DESKTOP_QUERY);
    if (!m) return;
    const onChange = () => setDesktop(m.matches);
    onChange();
    m.addEventListener("change", onChange);
    return () => m.removeEventListener("change", onChange);
  }, []);
  return desktop;
}
