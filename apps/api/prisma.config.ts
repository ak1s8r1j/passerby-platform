import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// The one .env lives at the repo root.
config({ path: "../../.env", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://passerby:passerby@localhost:5432/passerby",
  },
});
