import { notFound } from "next/navigation";
import {
  getCreditedLineIndexes,
  getDerivedStats,
  getLessonHistory,
  getResumeIndex,
  getSettings,
} from "@/lib/db/queries";
import { getLessonIndex, getLessonMeta, getLessonPairs } from "@/lib/lessons/catalog";
import type { HistoryEntry } from "@/lib/lesson-machine/machine";
import { getUser } from "@/lib/supabase/server";
import { LessonSession } from "./LessonSession";
import { NaturalLessonSession } from "./NaturalLessonSession";

export const dynamic = "force-dynamic";

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string }>;
  searchParams: Promise<{ autostart?: string }>;
}) {
  const { lessonId } = await params;
  const { autostart } = await searchParams;
  const meta = getLessonMeta(lessonId);
  if (!meta) notFound();

  const pairs = getLessonPairs(lessonId);
  const user = await getUser();

  let resumeIndex = 0;
  let history: HistoryEntry[] = [];
  let isFirstSession = true;
  let dbWarning = false;
  let lessonMode = "natural";
  let initialCredits: number[] = [];
  if (user) {
    try {
      const [resume, hist, stats, settings, credits] = await Promise.all([
        getResumeIndex(user.id, lessonId),
        getLessonHistory(user.id, lessonId),
        getDerivedStats(user.id),
        getSettings(user.id),
        getCreditedLineIndexes(user.id, lessonId),
      ]);
      resumeIndex = resume;
      history = hist;
      isFirstSession = stats.totalAttempts === 0;
      lessonMode = settings?.lessonMode ?? "natural";
      initialCredits = credits;
    } catch {
      dbWarning = true;
    }
  }

  const index = getLessonIndex();
  const position = index.findIndex((l) => l.id === lessonId);
  const nextLessonId = position >= 0 && position < index.length - 1 ? index[position + 1].id : null;

  if (lessonMode === "natural") {
    return (
      <NaturalLessonSession
        lessonId={lessonId}
        title={meta.title}
        pairs={pairs}
        initialCredits={initialCredits}
        nextLessonId={nextLessonId}
        autostart={autostart === "1"}
      />
    );
  }

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
      autostart={autostart === "1"}
    />
  );
}
