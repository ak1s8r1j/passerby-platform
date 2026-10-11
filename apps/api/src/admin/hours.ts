import type { AdminHour } from "@passerby/shared";

const HOUR = 3_600_000;

/** What the database keeps for one hour. */
export interface HourRow {
  hour: Date;
  visitors: number;
  chats: number;
  videoChats: number;
  messages: number;
  reports: number;
  bans: number;
  peakOnline: number;
}

/** The start of the hour that `at` falls in. */
export const startOfHour = (at: number) => Math.floor(at / HOUR) * HOUR;

/**
 * The last 24 hours as exactly 24 entries, oldest first and the current hour last, with zeros for hours
 * in which nothing happened, so a chart never has gaps or a different length.
 */
export function fillHours(rows: HourRow[], now: number, count = 24): AdminHour[] {
  const byHour = new Map(rows.map((r) => [r.hour.getTime(), r]));
  const last = startOfHour(now);
  const out: AdminHour[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const hour = last - i * HOUR;
    const r = byHour.get(hour);
    out.push({
      hour: new Date(hour).toISOString(),
      visitors: r?.visitors ?? 0,
      chats: r?.chats ?? 0,
      videoChats: r?.videoChats ?? 0,
      messages: r?.messages ?? 0,
      peakOnline: r?.peakOnline ?? 0,
    });
  }
  return out;
}
