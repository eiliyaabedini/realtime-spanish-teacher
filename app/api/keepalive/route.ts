import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Hit by a weekly Vercel cron so the Supabase free-tier project never pauses. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
