import { BanReason } from "@passerby/shared";
import type { Db } from "../db.js";
import type { Ban, BanStore, ReportSink } from "./engine.js";

/** Bans kept in Postgres, so they survive restarts and deploys. Expired bans are removed when noticed. */
export function prismaBans(db: Db): BanStore {
  return {
    async get(visitor) {
      const row = await db.ban.findUnique({ where: { visitor } });
      if (!row) return null;
      if (row.until.getTime() <= Date.now()) {
        await db.ban.delete({ where: { visitor } }).catch(() => undefined); // someone else may have removed it
        return null;
      }
      return toBan(row.until, row.reason);
    },
    async add(visitor, hours, reason) {
      const until = new Date(Date.now() + hours * 3600e3);
      await db.ban.upsert({
        where: { visitor },
        create: { visitor, until, reason },
        update: { until, reason },
      });
      return { until: until.getTime(), reason };
    },
  };
}

/** Reports kept in Postgres with the last messages, for a moderator to review. */
export function prismaReports(db: Db): ReportSink {
  return {
    async file(r) {
      await db.report.create({
        data: {
          mode: r.mode,
          reason: r.reason,
          reporter: r.reporter,
          reported: r.reported,
          transcript: r.transcript,
        },
      });
    },
  };
}

function toBan(until: Date, reason: string): Ban {
  const parsed = BanReason.safeParse(reason);
  return { until: until.getTime(), reason: parsed.success ? parsed.data : "rules" };
}
