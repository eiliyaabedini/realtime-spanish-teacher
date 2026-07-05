import { notFound } from "next/navigation";
import { getDerivedStats, getLessonHistory, getResumeIndex } from "@/lib/db/queries";
import { getLessonIndex, getLessonMeta, getLessonPairs } from "@/lib/lessons/catalog";
import type { HistoryEntry } from "@/lib/lesson-machine/machine";
import { getUser } from "@/lib/supabase/server";
import { LessonSession } from "./LessonSession";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const meta = getLessonMeta(lessonId);
  if (!meta) notFound();

  const pairs = getLessonPairs(lessonId);
  const user = await getUser();

  let resumeIndex = 0;
  let history: HistoryEntry[] = [];
  let isFirstSession = true;
  let dbWarning = false;
  if (user) {
    try {
      const [resume, hist, stats] = await Promise.all([
        getResumeIndex(user.id, lessonId),
        getLessonHistory(user.id, lessonId),
        getDerivedStats(user.id),
      ]);
      resumeIndex = resume;
      history = hist;
      isFirstSession = stats.totalAttempts === 0;
    } catch {
      dbWarning = true;
    }
  }

  const index = getLessonIndex();
  const position = index.findIndex((l) => l.id === lessonId);
  const nextLessonId = position >= 0 && position < index.length - 1 ? index[position + 1].id : null;

  return (
    <LessonSession
      lessonId={lessonId}
      title={meta.title}
      pairs={pairs}
      resumeIndex={resumeIndex}
      history={history}
      isFirstSession={isFirstSession}
      nextLessonId={nextLessonId}
      dbWarning={dbWarning}
    />
  );
}
