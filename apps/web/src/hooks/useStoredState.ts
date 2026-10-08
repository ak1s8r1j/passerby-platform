import { useCallback, useState } from "react";

/**
 * Like useState, but remembered in this browser (localStorage). If storage is unavailable
 * (private window, blocked) it quietly works as plain state. Stored data is untrusted, so
 * `valid` decides whether what was found is usable; otherwise the starting value is used.
 */
export function useStoredState<T>(
  key: string,
  initial: T,
  valid: (value: unknown) => value is T = (v): v is T => typeof v === typeof initial,
): [T, (value: T) => void] {
  const storageKey = "pb_" + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return initial;
      const parsed: unknown = JSON.parse(raw);
      return valid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage unavailable: keep the value for this visit only
      }
    },
    [storageKey],
  );
  return [value, set];
}
