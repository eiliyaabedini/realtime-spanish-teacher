import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAttempt } from "@/lib/db/queries";
import { getLessonMeta } from "@/lib/lessons/catalog";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({
  lessonId: z.string().min(1),
  lineIndex: z.number().int().min(0),
  userResponse: z.string().min(1).max(2000),
  isCorrect: z.boolean(),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (!getLessonMeta(parsed.data.lessonId)) {
    return NextResponse.json({ error: "unknown lesson" }, { status: 400 });
  }

  await recordAttempt(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
