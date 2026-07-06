import { NextResponse } from "next/server";
import { recordPracticeSession } from "@/lib/db/queries";
import { getUser } from "@/lib/supabase/server";

/** Marks a finished practice session — drives the lesson → practice → lesson journey. */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  await recordPracticeSession(user.id);
  return NextResponse.json({ ok: true });
}
