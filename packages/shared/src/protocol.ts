import { z } from "zod";

/**
 * The WebSocket conversation between browser and server.
 * Both sides import these schemas, so a change here is a compile error in both places.
 * Every message is a JSON object with a `t` (type) field.
 *
 * A typical text chat:
 *   browser: hello          server: ready
 *   browser: find           server: waiting            (or `wait` first, during the short cool-down)
 *                           server: matched            (someone was found)
 *   browser: msg / typing   server: msg / typing       (relayed to the other person)
 *   browser: find           server: ended (to the other person), then `waiting` for this one
 */

export const CHAT_MODES = ["text", "video"] as const;
export const ChatMode = z.enum(CHAT_MODES);
export type ChatMode = z.infer<typeof ChatMode>;

export const Gender = z.enum(["m", "f"]);
export type Gender = z.infer<typeof Gender>;

/** Languages people can say they speak. Matching prefers the same language. */
export const LANGUAGES = {
  en: "English",
  es: "Spanish",
  ar: "Arabic",
  hi: "Hindi",
  id: "Indonesian",
  tl: "Filipino",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  tr: "Turkish",
  ru: "Russian",
} as const;
export type LanguageCode = keyof typeof LANGUAGES;
export const LanguageCode = z.enum(Object.keys(LANGUAGES) as [LanguageCode, ...LanguageCode[]]);

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;
export const MAX_MESSAGE_LENGTH = 1000;

/** Messages the browser sends. */
export const ClientMessage = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({
    t: z.literal("hello"),
    /** The visitor confirmed they are 18 or older. Anything else is refused. */
    adult: z.literal(true),
    mode: ChatMode.default("text"),
    tags: z
      .array(z.string().max(MAX_TAG_LENGTH * 2))
      .max(MAX_TAGS * 2)
      .default([]),
    lang: LanguageCode.optional(),
    gender: Gender.optional(),
  }),
  /** Look for someone to talk to. Also means "Next": it ends the current chat first. */
  z.object({ t: z.literal("find") }),
  /** Stop looking, or leave the current chat, and go back to idle. */
  z.object({ t: z.literal("stop") }),
  z.object({ t: z.literal("msg"), text: z.string() }),
  z.object({ t: z.literal("typing") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Why someone was removed. `age` = said they were under 18; `rules` = moderators; `reports` = enough reports. */
export const BanReason = z.enum(["age", "rules", "reports"]);
export type BanReason = z.infer<typeof BanReason>;

/** Messages the server sends. */
export const ServerMessage = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ready"), online: z.number().int().nonnegative() }),
  z.object({ t: z.literal("count"), online: z.number().int().nonnegative() }),
  /** Looking for someone. */
  z.object({ t: z.literal("waiting") }),
  /** A short cool-down before searching (stops people skipping through strangers too fast). */
  z.object({ t: z.literal("wait"), ms: z.number().int().positive() }),
  /** Found someone. `common` lists shared interests. `init` is true for exactly one of the two people. */
  z.object({ t: z.literal("matched"), common: z.array(z.string()), init: z.boolean() }),
  z.object({ t: z.literal("msg"), text: z.string() }),
  z.object({ t: z.literal("typing") }),
  /** The other person left. */
  z.object({ t: z.literal("ended") }),
  z.object({ t: z.literal("banned"), until: z.number(), reason: BanReason }),
  z.object({ t: z.literal("error"), code: z.string(), text: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Parse text from the wire. Returns null for anything that is not a valid client message. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = ClientMessage.safeParse(data);
  return result.success ? result.data : null;
}

/**
 * Clean up interests the way the matcher compares them: lower case, letters/numbers/spaces only,
 * trimmed, at most 24 characters, no duplicates, at most 8.
 */
export function cleanTags(tags: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const t = raw
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim()
      .slice(0, MAX_TAG_LENGTH)
      .trim();
    if (t) out.add(t);
    if (out.size >= MAX_TAGS) break;
  }
  return [...out];
}
