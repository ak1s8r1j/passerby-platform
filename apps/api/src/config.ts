import { z } from "zod";
import type { IceServer } from "@passerby/shared";

/** A setting left blank in .env (`TURN_URL=`) means "not set", not an empty value. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const PLACEHOLDER_SECRET = "change-me-to-a-long-random-string";

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
