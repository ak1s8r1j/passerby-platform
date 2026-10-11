import { z } from "zod";
import { Sponsor, type AdsConfig, type IceServer } from "@passerby/shared";

/** A setting left blank in .env (`TURN_URL=`) means "not set", not an empty value. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const PLACEHOLDER_SECRET = "change-me-to-a-long-random-string";

/** "true" or "false"; left blank means the default. */
const flag = (fallback: boolean) =>
  z
    .preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["true", "false"]).default(fallback ? "true" : "false"),
    )
    .transform((v) => v === "true");

/** Sponsor cards as JSON in one setting. A bad list stops the server with a clear message. */
const sponsorList = z
  .preprocess((v) => (v === "" ? undefined : v), z.string().optional())
  .transform((text, ctx) => {
    if (text === undefined) return [];
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      ctx.addIssue({ code: "custom", message: "ADS_SPONSORS must be a JSON list" });
      return z.NEVER;
    }
    const parsed = z.array(Sponsor).max(10).safeParse(data);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: `ADS_SPONSORS: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "is not valid"}`,
      });
      return z.NEVER;
    }
    // Pictures load from this site only, and links must be https: refuse anything else here, not in the page.
    for (const s of parsed.data) {
      if (!/^(\/[\w./-]+|data:image\/(png|jpeg|webp|gif|svg\+xml)[;,].*)$/.test(s.logo)) {
        ctx.addIssue({
          code: "custom",
          message: `ADS_SPONSORS: logo for "${s.id}" must be a path on this site ("/sponsors/x.png") or a data:image URL`,
        });
        return z.NEVER;
      }
      if (!s.url.startsWith("https://")) {
        ctx.addIssue({ code: "custom", message: `ADS_SPONSORS: link for "${s.id}" must be https` });
        return z.NEVER;
      }
    }
    return parsed.data;
  });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
    PUBLIC_URL: z.url().default("http://localhost:5173"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** The site's name, shown on the pages. */
    SITE_NAME: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).max(40).default("Passerby"),
    ),
    /** Where people can write about bans, privacy or payments. Shown on the Rules, Terms and Privacy pages. */
    CONTACT_EMAIL: optional(z.string().max(120)),
    /** "Continue with Google": both come from the Google Cloud console. Leave both blank to switch it off. */
    GOOGLE_CLIENT_ID: optional(z.string()),
    GOOGLE_CLIENT_SECRET: optional(z.string()),
    /** Only for testing against a stand-in for Google. Leave blank in real life. */
    GOOGLE_AUTH_URL: optional(z.url()),
    GOOGLE_TOKEN_URL: optional(z.url()),
    GOOGLE_JWKS_URL: optional(z.url()),
    GOOGLE_ISSUER: optional(z.string()),
    /** Show the Sign in / account link in the header. Off hides it; /account and everything behind it still work. */
    ACCOUNT_LINK: z
      .preprocess((v) => (v === "" ? undefined : v), z.enum(["true", "false"]).default("false"))
      .transform((v) => v === "true"),
    /** The admin area's sign-in. With no ADMIN_KEY the admin area is switched off. */
    ADMIN_USER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).max(100).default("admin"),
    ),
    ADMIN_KEY: optional(z.string().min(12, "ADMIN_KEY must be at least 12 characters")),
    /** How long the activity log is kept. */
    EVENT_RETENTION_DAYS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce.number().int().min(1).max(3650).default(30),
    ),
    /** How long reports, with their saved messages, are kept. */
    REPORT_RETENTION_DAYS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce.number().int().min(1).max(3650).default(90),
    ),
    /** Set to "false" to switch video chat off for everyone. */
    VIDEO_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /** A relay server so video works on strict networks. Without one, some pairs cannot connect. */
    TURN_URL: optional(z.string()),
    TURN_USER: optional(z.string()),
    TURN_PASS: optional(z.string()),
    /** Folder with the built web app. When set, the API serves it too (production). */
    WEB_DIST: optional(z.string()),
    /** The one switch for ads: "false" removes every ad, sponsor card and rewarded ad. */
    ADS_ENABLED: flag(true),
    /** The AdSense publisher ID, like ca-pub-1234567890123456. Without it no AdSense unit is drawn. */
    ADSENSE_CLIENT: optional(
      z.string().regex(/^ca-pub-\d{8,20}$/, "ADSENSE_CLIENT looks like ca-pub-1234567890123456"),
    ),
    /** AdSense ad unit IDs (numbers), made in the AdSense console. A place without one shows nothing. */
    ADSENSE_SLOT_PROFILE: optional(
      z.string().regex(/^\d{6,20}$/, "an AdSense ad unit ID is a number"),
    ),
    ADSENSE_SLOT_LANDING: optional(
      z.string().regex(/^\d{6,20}$/, "an AdSense ad unit ID is a number"),
    ),
    /** Sponsor cards for the text chat, as a JSON list of {id, name, logo, headline, cta, url}. */
    ADS_SPONSORS: sponsorList,
    /** The rewarded video ad provider. "none" hides the button. "demo" is a stand-in for trying the flow. */
    REWARDED_ADS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["none", "demo"]).default("none"),
    ),
    /** Seconds between profile banner refreshes (60 or more), or 0 for never. AdSense does not allow refreshing. */
    ADS_REFRESH_SECONDS: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.coerce
        .number()
        .int()
        .refine((n) => n === 0 || (n >= 60 && n <= 3600), "use 0, or 60 to 3600")
        .default(0),
    ),
    /** Make country and who-to-talk-to Plus features (or unlockable with a rewarded ad). Off: they stay free. */
    PLUS_FILTERS: flag(false),
    /** Plus can be bought. Leave off until payments are connected. */
    PLUS_CHECKOUT: flag(false),
  })
  .refine((env) => Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET), {
    message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
    path: ["GOOGLE_CLIENT_SECRET"],
  });

export type Config = z.infer<typeof EnvSchema>;

/** Read and check the settings once, at start-up. A bad setting stops the server with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid settings:\n${problems}`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.SESSION_SECRET === PLACEHOLDER_SECRET) {
    throw new Error("Invalid settings:\n  SESSION_SECRET: set a real secret in production");
  }
  return parsed.data;
}

/** The ads part of what the browser is told. Nothing is shown when the master switch is off. */
export function adsConfig(
  config: Pick<
    Config,
    | "ADS_ENABLED"
    | "ADSENSE_CLIENT"
    | "ADSENSE_SLOT_PROFILE"
    | "ADSENSE_SLOT_LANDING"
    | "ADS_SPONSORS"
    | "REWARDED_ADS"
    | "ADS_REFRESH_SECONDS"
  >,
): AdsConfig {
  if (!config.ADS_ENABLED) {
    return {
      enabled: false,
      client: null,
      slots: { profile: null, landing: null },
      sponsors: [],
      rewarded: "none",
      refreshSeconds: 0,
    };
  }
  return {
    enabled: true,
    client: config.ADSENSE_CLIENT ?? null,
    slots: {
      profile: config.ADSENSE_SLOT_PROFILE ?? null,
      landing: config.ADSENSE_SLOT_LANDING ?? null,
    },
    sponsors: config.ADS_SPONSORS,
    rewarded: config.REWARDED_ADS,
    refreshSeconds: config.ADS_REFRESH_SECONDS,
  };
}

/** Google's free STUN server helps two browsers find their public addresses. */
export const DEFAULT_STUN = "stun:stun.l.google.com:19302";

/**
 * The servers the browser should use to connect video. A TURN relay (if configured) is added after
 * STUN. Its username and password are sent to every visitor, so use a relay account made for this
 * and nothing else.
 */
export function iceServers(
  config: Pick<Config, "TURN_URL" | "TURN_USER" | "TURN_PASS">,
): IceServer[] {
  const servers: IceServer[] = [{ urls: DEFAULT_STUN }];
  if (config.TURN_URL) {
    servers.push({
      urls: config.TURN_URL,
      username: config.TURN_USER ?? "",
      credential: config.TURN_PASS ?? "",
    });
  }
  return servers;
}
