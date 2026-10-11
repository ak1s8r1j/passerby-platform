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
  /** What they say they are: "m", "f", or "" if they did not say. */
  gender: string;
  /** Who they want to talk to: "m", "f", or "" for anyone. */
  seek: string;
  /** Where they are connecting from (two-letter code), or "" if it could not be worked out. */
  country?: string;
  /** Countries they want to talk to; empty means anywhere. */
  seekCountries?: readonly string[];
  /** When they started looking (milliseconds). */
  queuedAt: number;
  /** The connection they last talked to. */
  lastPartner: string;
  /** People they must never be matched with (for example someone they reported). */
  blocked: ReadonlySet<string>;
}

/**
 * Does each person's gender filter allow the other? Someone who wants only women is matched only with
 * people who say they are women (and who in turn don't want to talk to only men, and so on). Unlike interests,
 * this is never relaxed by waiting: a filter that gave up after a few seconds would not be a filter.
 */
export const gendersAgree = (a: Seeker, b: Seeker) =>
  (a.seek === "" || a.seek === b.gender) && (b.seek === "" || b.seek === a.gender);

/**
 * Does each person's country filter allow the other? Someone who picked countries is only matched with people
 * known to be from one of them: a person whose country could not be worked out is not guessed at.
 */
export const countriesAgree = (a: Seeker, b: Seeker) =>
  (!a.seekCountries?.length || a.seekCountries.includes(b.country ?? "")) &&
  (!b.seekCountries?.length || b.seekCountries.includes(a.country ?? ""));

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
  if (!gendersAgree(a, b) || !countriesAgree(a, b)) return -1;
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
