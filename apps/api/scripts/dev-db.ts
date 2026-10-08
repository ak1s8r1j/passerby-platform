// A local Postgres that needs no Docker. Same address as docker-compose.yml, so .env works for both.
//   npm run db:embedded     (leave it running in its own terminal; Ctrl+C stops it; data is kept in ./.pg-data)
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const dir = resolve(import.meta.dirname, "../../../.pg-data");
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "passerby",
  password: "passerby",
  port: 5432,
  persistent: true,
});

if (!existsSync(resolve(dir, "PG_VERSION"))) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("passerby");
} catch {
  // already exists
}
console.log("Postgres is running: postgresql://passerby:passerby@localhost:5432/passerby");
console.log("Press Ctrl+C to stop it.");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
