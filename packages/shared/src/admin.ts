import { z } from "zod";

/**
 * The admin area's API: what the owner sends and what comes back.
 * People are shown only as the first 8 characters of their scrambled ID (`tag`), the same label the
 * activity log uses, so a report, a ban and a log line about the same person can be matched up.
 */

export const AdminLoginRequest = z.object({
  user: z.string().min(1).max(100),
  key: z.string().min(1).max(200),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequest>;

/** The longest ban an admin can set: one year. */
export const MAX_BAN_HOURS = 8760;
export const BanRequest = z.object({
  hours: z.number().int().min(1).max(MAX_BAN_HOURS),
});
export type BanRequest = z.infer<typeof BanRequest>;

export const LiftBanRequest = z.object({ visitor: z.string().min(1).max(100) });
export type LiftBanRequest = z.infer<typeof LiftBanRequest>;

/** Puts a lifted ban back exactly as it was (the Undo after lifting one). */
export const RestoreBanRequest = z.object({
  visitor: z.string().min(1).max(100),
  /** Milliseconds since 1970. */
  until: z.number().int().positive(),
  reason: z.enum(["age", "rules", "reports"]),
});
export type RestoreBanRequest = z.infer<typeof RestoreBanRequest>;

export type AdminReportStatus = "open" | "banned" | "dismissed";

export interface AdminMe {
  /** False when the server has no ADMIN_KEY, so the admin area is switched off. */
  enabled: boolean;
  /** The signed-in admin's name, or null. */
  admin: string | null;
}

export interface AdminLive {
  online: number;
  text: number;
  video: number;
  /** People looking for a partner, or waiting out the skip cool-down. */
  searching: number;
  /** People in a conversation right now (two per chat). */
  chatting: number;
}

export interface AdminHour {
  /** Start of the hour, ISO. */
  hour: string;
  visitors: number;
  chats: number;
  videoChats: number;
  messages: number;
  peakOnline: number;
}

export interface AdminOverview {
  live: AdminLive;
  /** The last 24 hours. */
  day: {
    visitors: number;
    chats: number;
    messages: number;
    reports: number;
    newUsers: number;
    bans: number;
  };
  totals: { users: number; openReports: number; activeBans: number };
  /** 24 entries, oldest first, the current hour last, with zeros for quiet hours. */
  hours: AdminHour[];
  /** A few of the newest open reports. */
  recentReports: AdminReport[];
}

export interface AdminReport {
  id: string;
  createdAt: string;
  mode: string;
  reason: string;
  /** "system" for an automatic report, otherwise a short ID. */
  reporter: string;
  /** Short ID of the person reported. */
  reported: string;
  status: AdminReportStatus;
  messages: number;
}

export interface TranscriptLine {
  who: "reporter" | "reported";
  x: string;
}

export interface AdminReportDetail extends AdminReport {
  transcript: TranscriptLine[];
  /** How many different people reported this person in the last 24 hours (including this report). */
  reportersToday: number;
  /** All reports ever kept about this person. */
  reportsTotal: number;
  /** The ban in force on this person right now, if any. */
  ban: AdminBan | null;
}

/**
 * The answer to banning someone from a report. Banning also closes the other open reports about the same
 * person, so `settled` lists every report it closed, which lets the page put them all back on Undo.
 */
export interface AdminBanResult {
  report: AdminReportDetail;
  /** IDs of the reports that were open and are now closed (this one included, if it was open). */
  settled: string[];
}

export interface AdminBan {
  /** The full scrambled ID. Used to lift the ban; shown to people only as `tag`. */
  id: string;
  tag: string;
  reason: "age" | "rules" | "reports";
  /** Milliseconds since 1970. */
  until: number;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
  google: boolean;
  hasPassword: boolean;
  suspended: boolean;
  premiumUntil: string | null;
}

export interface AdminEvent {
  /** A string, because the database's number is too big for JSON. */
  id: string;
  at: string;
  kind: "user" | "admin" | "system";
  type: string;
  visitor: string;
  detail: string;
}

/** One page of a list. Pass `next` back as `cursor` to get the following page. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface AdminSystem {
  version: string;
  node: string;
  uptimeSeconds: number;
  memoryMb: number;
  database: { up: boolean; ms: number };
  online: number;
  settings: {
    siteName: string;
    publicUrl: string;
    video: boolean;
    googleSignIn: boolean;
    turn: boolean;
    contact: boolean;
    environment: string;
  };
  retention: { eventDays: number; reportDays: number };
  counts: { users: number; reports: number; bans: number; events: number };
  problems: AdminEvent[];
}
