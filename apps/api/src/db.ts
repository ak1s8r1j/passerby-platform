import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export type Db = PrismaClient;

export function createDb(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** What the HTTP layer needs from the database. Tests pass a stand-in. */
export interface Health {
  ping(): Promise<boolean>;
}

export function dbHealth(db: Db): Health {
  return {
    async ping() {
      try {
        await db.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },
  };
}
