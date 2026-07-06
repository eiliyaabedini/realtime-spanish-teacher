import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAttempt, recordAttempts } from "@/lib/db/queries";
import { getLessonMeta } from "@/lib/lessons/catalog";
import { getUser } from "@/lib/supabase/server";

const Attempt = z.object({
  lessonId: z.string().min(1),
  lineIndex: z.number().int().min(0),
  userResponse: z.string().min(1).max(2000),
  isCorrect: z.boolean(),
});

// single attempt (line-by-line mode) or a chunk-end batch (natural mode)
const Body = z.union([Attempt, z.object({ attempts: z.array(Attempt).min(1).max(80) })]);

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if ("attempts" in parsed.data) {
    const attempts = parsed.data.attempts;
    if (attempts.some((a) => !getLessonMeta(a.lessonId))) {
      return NextResponse.json({ error: "unknown lesson" }, { status: 400 });
    }
    await recordAttempts(user.id, attempts);
    return NextResponse.json({ ok: true, recorded: attempts.length });
  }

  if (!getLessonMeta(parsed.data.lessonId)) {
    return NextResponse.json({ error: "unknown lesson" }, { status: 400 });
  }
  await recordAttempt(user.id, parsed.data);
  return NextResponse.json({ ok: true });
}
