import { z } from "zod";
import { CountryCode, MAX_COUNTRIES } from "./countries.js";

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

/** Longest session description (a WebRTC offer or answer) we will relay. Real ones are about 5 to 12 KB. */
export const MAX_SDP_LENGTH = 30_000;

/**
 * The setup messages two browsers swap to connect their video directly (WebRTC).
 * The server only carries them between the two people in a video chat and never reads them.
 * Anything that is not exactly one of these shapes is dropped, and unknown fields are stripped,
 * so this channel cannot be used to send anything else.
 */
export const SessionDescription = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().max(MAX_SDP_LENGTH),
});
export type SessionDescription = z.infer<typeof SessionDescription>;

export const IceCandidate = z.object({
  candidate: z.string().max(2000),
  sdpMid: z.string().max(100).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  usernameFragment: z.string().max(100).nullable().optional(),
});
export type IceCandidate = z.infer<typeof IceCandidate>;

/** `s` carries a session description, `c` carries an ICE candidate. */
export const Signal = z.union([z.object({ s: SessionDescription }), z.object({ c: IceCandidate })]);
export type Signal = z.infer<typeof Signal>;

/** Why someone reports a chat. */
export const REPORT_REASONS = ["nudity", "underage", "harassment", "spam", "other"] as const;
export const ReportReason = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof ReportReason>;

/** What each reason is called on screen. */
export const REPORT_REASON_LABELS: Record<ReportReason | "system", string> = {
  nudity: "Nudity or sexual content",
  underage: "Seems to be under 18",
  harassment: "Harassment or hate",
  spam: "Spam or advertising",
  other: "Something else",
  system: "Automatic",
};

/** The quick reactions one person can send to another. Only these exact emoji are accepted. */
export const REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "👋"] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

/** The longest line of text a game can carry. */
export const MAX_GAME_TEXT_LENGTH = 120;

/** The games two people can play in a chat. */
export const GAME_IDS = ["wyr", "rps", "ttt", "c4", "trivia", "ttl"] as const;
export const GameId = z.enum(GAME_IDS);
export type GameId = z.infer<typeof GameId>;

/**
 * A small message in a game between the two people in a chat. The server only passes these along; the rules
 * are worked out by each browser. `seed` is a number both browsers use to pick the same questions or who
 * goes first. A move is a round number `r` and a choice `v` (0 to 8: a rock-paper-scissors pick, a
 * would-you-rather side, a tic-tac-toe square, a Connect 4 column, a trivia answer, or a guess). `say` is a
 * line of text a game needs (the statements in Two truths and a lie), so it goes through the same checks as
 * a chat message.
 */
export const GameMessage = z.discriminatedUnion("k", [
  z.object({ k: z.literal("invite"), game: GameId, seed: z.number().int().min(0).max(1_000_000) }),
  z.object({ k: z.literal("accept") }),
  z.object({ k: z.literal("decline") }),
  z.object({ k: z.literal("quit") }),
  z.object({
    k: z.literal("move"),
    r: z.number().int().min(0).max(50),
    v: z.number().int().min(0).max(8),
  }),
  z.object({
    k: z.literal("say"),
    i: z.number().int().min(0).max(2),
    text: z.string().max(MAX_GAME_TEXT_LENGTH),
  }),
]);
export type GameMessage = z.infer<typeof GameMessage>;

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
    /** What they say they are. Others who filter by gender can only match someone who says. */
    gender: Gender.optional(),
    /** Who they would like to talk to. Left out means anyone. */
    seek: Gender.optional(),
    /**
     * Only people from these countries. Left empty means anywhere. A person's own country is never sent by
     * the browser: the server works it out from the connection.
     */
    countries: z.array(CountryCode).max(MAX_COUNTRIES).optional(),
  }),
  /** Look for someone to talk to. Also means "Next": it ends the current chat first. */
  z.object({ t: z.literal("find") }),
  /** Stop looking, or leave the current chat, and go back to idle. */
  z.object({ t: z.literal("stop") }),
  z.object({ t: z.literal("msg"), text: z.string() }),
  z.object({ t: z.literal("typing") }),
  /** Video setup for the other person. Only relayed in a video chat. */
  z.object({ t: z.literal("sig"), d: Signal }),
  /**
   * Tell the other person whether this camera looks like a virtual camera (software that makes up a picture).
   * Only relayed between two people in a video chat.
   */
  z.object({ t: z.literal("cam"), virtual: z.boolean() }),
  /** A move or invitation in a game with the other person. */
  z.object({ t: z.literal("game"), g: GameMessage }),
  /** A quick reaction (an emoji that floats up on the other person's screen). */
  z.object({ t: z.literal("react"), e: Reaction }),
  /** Report the person in this chat, or in the chat that just ended. Ends the chat. */
  z.object({ t: z.literal("report"), reason: ReportReason }),
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
  z.object({
    t: z.literal("matched"),
    common: z.array(z.string()),
    init: z.boolean(),
    /** Where the other person is connecting from, if that could be worked out. */
    country: CountryCode.optional(),
  }),
  z.object({ t: z.literal("msg"), text: z.string() }),
  z.object({ t: z.literal("typing") }),
  /** Video setup from the other person. */
  z.object({ t: z.literal("sig"), d: Signal }),
  /** The other person left. */
  z.object({ t: z.literal("ended") }),
  /** The other person's camera looks like a virtual camera (or no longer does). */
  z.object({ t: z.literal("cam"), virtual: z.boolean() }),
  /** A move or invitation in a game from the other person. */
  z.object({ t: z.literal("game"), g: GameMessage }),
  /** A quick reaction from the other person. */
  z.object({ t: z.literal("react"), e: Reaction }),
  /** The report was saved. */
  z.object({ t: z.literal("reported") }),
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
