import type { ChatMode } from "@passerby/shared";

/** After waiting this long, anyone looking for the same kind of chat will do, shared interest or not. */
export const FALLBACK_MS = 4000;
/** Two people who just talked are not paired again until one of them has waited this long. */
export const REMATCH_MS = 2 * FALLBACK_MS;

/** What the matcher needs to know about someone who is looking for a chat. */
export interface Seeker {
  /** The connection (one per browser tab). */
  id: string;
  /** The person, as a scrambled ID: stays the same across tabs and reconnects. */
  visitor: string;
  mode: ChatMode;
  tags: readonly string[];
  lang: string;
  /** When they started looking (milliseconds). */
  queuedAt: number;
  /** The connection they last talked to. */
  lastPartner: string;
  /** People they must never be matched with (for example someone they reported). */
  blocked: ReadonlySet<string>;
}

/** Someone with no interests, or who has waited a while, is happy with any partner. */
export const isRelaxed = (s: Seeker, now: number) =>
  s.tags.length === 0 || now - s.queuedAt >= FALLBACK_MS;

export const sharedTags = (a: Seeker, b: Seeker) => a.tags.filter((t) => b.tags.includes(t));

/**
 * How good a pair these two would be, or -1 if they must not be paired right now.
 * Shared interests count most; speaking the same language breaks ties.
 */
export function score(a: Seeker, b: Seeker, now: number): number {
  if (a.id === b.id || a.mode !== b.mode) return -1;
  if (a.blocked.has(b.visitor) || b.blocked.has(a.visitor)) return -1;
  const common = sharedTags(a, b).length;
  // With nothing in common, both must be happy to take anyone.
  if (common === 0 && (!isRelaxed(a, now) || !isRelaxed(b, now))) return -1;
  // No instant rematch with the person they just left.
  if (
    (a.lastPartner === b.id || b.lastPartner === a.id) &&
    (now - a.queuedAt < REMATCH_MS || now - b.queuedAt < REMATCH_MS)
  ) {
    return -1;
  }
  return common * 2 + (a.lang && a.lang === b.lang ? 1 : 0);
}

/** The best partner for `seeker` among those waiting. On a tie, whoever has waited longest wins. */
export function bestPartner<T extends Seeker>(
  seeker: Seeker,
  waiting: readonly T[],
  now: number,
): T | null {
  let best: T | null = null;
  let top = -1;
  for (const other of waiting) {
    const s = score(seeker, other, now);
    if (s > top) {
      top = s;
      best = other;
    }
  }
  return best;
}
