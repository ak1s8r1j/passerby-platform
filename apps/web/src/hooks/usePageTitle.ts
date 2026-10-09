import { useEffect } from "react";
import { useSiteConfig } from "./useSiteConfig.js";

/**
 * Sets the browser tab's title for this page ("Account | Passerby"). A page built in the browser has to
 * do this itself, and leaves the title as it found it when the visitor moves on.
 */
export function usePageTitle(title?: string) {
  const { config } = useSiteConfig();
  useEffect(() => {
    const before = document.title;
    document.title = title ? `${title} | ${config.name}` : `${config.name} | Chat with a stranger`;
    return () => {
      document.title = before;
    };
  }, [title, config.name]);
}
