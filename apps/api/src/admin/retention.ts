import type { Db } from "../db.js";

const DAY = 86_400_000;

export interface RetentionSettings {
  /** The activity log is kept this many days. */
  eventDays: number;
  /** Reports, with their saved messages, are kept this many days. */
  reportDays: number;
}

/** Hourly counters are tiny, so they are kept much longer than anything that holds words. */
export const STATS_DAYS = 400;
/** A ban that ran out is kept this long, so a moderator can still see it, then removed. */
export const EXPIRED_BAN_DAYS = 7;

export interface RetentionResult {
  events: number;
  reports: number;
  stats: number;
  bans: number;
}

/**
 * Delete what is past its keep-until date: old activity, old reports (and the messages saved with them),
 * old hourly counters and bans that ran out a while ago. Safe to run as often as you like.
 */
export async function runRetention(
  db: Db,
  settings: RetentionSettings,
  now = Date.now(),
): Promise<RetentionResult> {
  const before = (days: number) => new Date(now - days * DAY);
  const [events, reports, stats, bans] = await Promise.all([
    db.event.deleteMany({ where: { at: { lt: before(settings.eventDays) } } }),
    db.report.deleteMany({ where: { createdAt: { lt: before(settings.reportDays) } } }),
    db.hourlyStat.deleteMany({ where: { hour: { lt: before(STATS_DAYS) } } }),
    db.ban.deleteMany({ where: { until: { lt: before(EXPIRED_BAN_DAYS) } } }),
  ]);
  return {
    events: events.count,
    reports: reports.count,
    stats: stats.count,
    bans: bans.count,
  };
}
