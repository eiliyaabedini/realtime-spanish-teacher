import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Use the Supabase *transaction pooler* URL (port 6543) — required on serverless.
    url: process.env.DATABASE_URL ?? "",
  },
});
