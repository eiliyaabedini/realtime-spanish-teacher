import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // prepare: false — required behind Supabase's transaction pooler (pgbouncer).
    const client = postgres(url, { prepare: false, max: 1 });
    _db = drizzle(client, { schema });
  }
  return _db;
}
