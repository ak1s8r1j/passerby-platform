// A throwaway Postgres for the end-to-end scripts in /e2e, which create and delete real data.
//   npm run db:e2e     (leave it running in its own terminal; Ctrl+C stops it and deletes everything)
// It listens on port 54330, so it can't touch your development database on 5432.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const PORT = Number(process.env.E2E_DB_PORT ?? 54330);
const dir = mkdtempSync(join(tmpdir(), "passerby-e2e-"));
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "e2e",
  password: "e2e",
  port: PORT,
  persistent: false,
});
await pg.initialise();
await pg.start();
await pg.createDatabase("passerby_e2e");

const url = `postgresql://e2e:e2e@localhost:${PORT}/passerby_e2e`;
const prisma = resolve(import.meta.dirname, "../../../node_modules/prisma/build/index.js");
execFileSync(process.execPath, [prisma, "migrate", "deploy"], {
  cwd: resolve(import.meta.dirname, ".."),
  env: { ...process.env, DATABASE_URL: url },
  stdio: "inherit",
});

console.log(`\nThrowaway Postgres is running, with all migrations applied:\n  ${url}`);
console.log("Start the API with DATABASE_URL set to that. Press Ctrl+C to stop and delete it.");

const stop = async () => {
  await pg.stop();
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
