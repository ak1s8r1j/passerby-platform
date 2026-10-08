import { z } from "zod";

const PLACEHOLDER_SECRET = "change-me-to-a-long-random-string";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 characters"),
  PUBLIC_URL: z.url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Folder with the built web app. When set, the API serves it too (production). */
  WEB_DIST: z.string().optional(),
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
