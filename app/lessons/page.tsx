import { Header } from "@/components/Header";
import { LessonCard } from "@/components/LessonCard";
import { getLessonIndex, getLessonPairs } from "@/lib/lessons/catalog";
import { getAllLessonStats, getStreak, type LessonStats } from "@/lib/db/queries";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LessonsPage() {
  const user = await getUser();
  const lessons = getLessonIndex();

  let stats: LessonStats[] = [];
  let streak = 0;
  let dbError = false;
  if (user) {
    try {
      [stats, streak] = await Promise.all([getAllLessonStats(user.id), getStreak(user.id)]);
    } catch {
      dbError = true;
    }
  }
  const statsById = new Map(stats.map((s) => [s.lessonId, s]));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <Header streak={streak} />

      {dbError && (
        <p className="mb-6 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Progress database isn&apos;t reachable — lessons work, but progress won&apos;t be saved.
          Check <code>DATABASE_URL</code> and that migrations have run.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {lessons.map((lesson) => {
          const pairs = getLessonPairs(lesson.id);
          const s = statsById.get(lesson.id);
          return (
            <LessonCard
              key={lesson.id}
              id={lesson.id}
              title={lesson.title}
              description={lesson.description}
              totalPairs={pairs.length}
              correctLines={s?.correctLines ?? 0}
              resumeIndex={s?.resumeIndex ?? 0}
            />
          );
        })}
      </div>
    </div>
  );
}
