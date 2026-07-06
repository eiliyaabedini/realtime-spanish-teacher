import { NextResponse } from "next/server";
import { getLessonMeta, getLessonPairs } from "@/lib/lessons/catalog";
import { getUser } from "@/lib/supabase/server";

/** Lesson lines for the practice session's get_lesson_content tool. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lessonId: string }> },
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { lessonId } = await params;
  const meta = getLessonMeta(lessonId);
  if (!meta) return NextResponse.json({ error: "unknown lesson" }, { status: 404 });

  return NextResponse.json({ id: meta.id, title: meta.title, pairs: getLessonPairs(lessonId) });
}
