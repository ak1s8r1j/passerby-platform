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
