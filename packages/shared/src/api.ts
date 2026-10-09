import { z } from "zod";

/** Response shapes for the HTTP API. The web app and the API both import these. */

export const HealthResponse = z.object({
  ok: z.boolean(),
  version: z.string(),
  database: z.enum(["up", "down"]),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const StatsResponse = z.object({
  online: z.number().int().nonnegative(),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

/** The shape of every error the API returns. */
export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** A server that helps two browsers find each other (STUN) or relays their video when they can't connect (TURN). */
export const IceServer = z.object({
  urls: z.string(),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** What the browser needs to know before it starts: is video on, and which servers to use for it. */
export const SiteConfig = z.object({
  video: z.boolean(),
  iceServers: z.array(IceServer),
});
export type SiteConfig = z.infer<typeof SiteConfig>;
