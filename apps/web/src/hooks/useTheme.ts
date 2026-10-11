import { useEffect } from "react";
import { useStoredState } from "./useStoredState.js";

export type Theme = "light" | "dark";
const isTheme = (v: unknown): v is Theme | "" => v === "" || v === "light" || v === "dark";

const systemTheme = (): Theme =>
  typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

/**
 * Light or dark. Until the visitor chooses, it follows their system; once they press the switch, their
 * choice is remembered in this browser. The page reads it from the `data-theme` attribute on <html>.
 */
export function useTheme() {
  const [stored, setStored] = useStoredState<Theme | "">("theme", "", isTheme);
  const theme: Theme = stored || systemTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return { theme, toggle: () => setStored(theme === "dark" ? "light" : "dark") };
}
