import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = 54329;

/** Starts a throwaway Postgres, applies every migration, and tells the tests where it is. */
export default async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "passerby-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "test",
    password: "test",
    port: PORT,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("passerby_test");

  const url = `postgresql://test:test@localhost:${PORT}/passerby_test`;
  process.env.DATABASE_URL = url;
  // Run Prisma's own entry point with this same Node, so there is no shell involved.
  const prisma = resolve(import.meta.dirname, "../../../node_modules/prisma/build/index.js");
  execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });

  return async () => {
    await pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
