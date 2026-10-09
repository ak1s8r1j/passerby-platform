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
  /** The site's name, as the operator wants it shown. */
  name: z.string().default("Passerby"),
  /** Where people can write about bans, privacy or payments. Null when none is set. */
  contact: z.string().nullable().default(null),
  /** Whether "Continue with Google" is switched on. */
  googleSignIn: z.boolean().default(false),
});
export type SiteConfig = z.infer<typeof SiteConfig>;

// ---------- accounts ----------
// Used by the server to check requests and by the sign-up form to give the same answers before sending.
// The messages are written to be shown to people as they are.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const NAME_MIN = 2;
export const NAME_MAX = 24;
export const EMAIL_MAX = 120;

const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
const NAME_PATTERN = /^[\p{L}\p{N} ._-]+$/u;

const MSG = {
  adult: "Confirm that you are 18 or older.",
  email: "Enter a valid email address.",
  name: `Pick a name of ${NAME_MIN} to ${NAME_MAX} letters, numbers or spaces.`,
  password: `Use a password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`,
  newPassword: `Use a new password of ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`,
};

/** Lower-cased and trimmed, so "Sam@Example.com " and "sam@example.com" are the same address. */
export const EmailAddress = z
  .string(MSG.email)
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX, MSG.email)
  .regex(EMAIL_PATTERN, MSG.email);

/** Spaces tidied, then letters, numbers, spaces, dot, underscore or hyphen. */
export const DisplayName = z
  .string(MSG.name)
  .trim()
  .transform((s) => s.replace(/\s+/g, " "))
  .pipe(z.string().min(NAME_MIN, MSG.name).max(NAME_MAX, MSG.name).regex(NAME_PATTERN, MSG.name));

export const NewPassword = z
  .string(MSG.password)
  .min(PASSWORD_MIN, MSG.password)
  .max(PASSWORD_MAX, MSG.password);

export const RegisterRequest = z.object({
  email: EmailAddress,
  name: DisplayName,
  password: NewPassword,
  adult: z.literal(true, MSG.adult),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;

/** Sign-in is deliberately lenient: it only has to find the account, never to teach what a good password is. */
export const LoginRequest = z.object({
  email: z.string().trim().toLowerCase().max(EMAIL_MAX),
  password: z.string().max(PASSWORD_MAX),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * `password` is the current one. Someone who signed up with Google has no password yet, so they can
 * leave it out to set their first one.
 */
export const ChangePasswordRequest = z.object({
  password: z.string().max(PASSWORD_MAX).optional(),
  next: z
    .string(MSG.newPassword)
    .min(PASSWORD_MIN, MSG.newPassword)
    .max(PASSWORD_MAX, MSG.newPassword),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/**
 * To delete an account, confirm with the password. Someone with no password (Google only)
 * confirms by typing the email address on the account instead.
 */
export const DeleteAccountRequest = z
  .object({
    password: z.string().max(PASSWORD_MAX).optional(),
    email: z.string().max(EMAIL_MAX).optional(),
  })
  .refine((v) => v.password !== undefined || v.email !== undefined, {
    message: "Confirm with your password, or with your email address.",
  });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

/** What an account looks like to its owner. The password hash never leaves the server. */
export const PublicUser = z.object({
  name: z.string(),
  email: z.string(),
  /** ISO date and time. */
  createdAt: z.string(),
  /** False for someone who only signs in with Google. */
  hasPassword: z.boolean(),
  /** Whether a Google account is connected. */
  google: z.boolean(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const MeResponse = z.object({ user: PublicUser.nullable() });
export type MeResponse = z.infer<typeof MeResponse>;
