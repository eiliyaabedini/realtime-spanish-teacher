import { Header } from "@/components/Header";
import { LessonCard } from "@/components/LessonCard";
import { getLessonIndex, getLessonPairs } from "@/lib/lessons/catalog";
import { getAllLessonStats, getStreak, type LessonStats } from "@/lib/db/queries";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CHAPTER_NAMES: Record<string, string> = {
  "1": "Primeros pasos · First steps",
  "2": "El mundo alrededor · The world around you",
  "3": "Conversaciones · Real conversations",
  "4": "Más allá · Going further",
};

/** "lesson2p3" → { chapter: "2", badge: "2.3" } */
function chapterInfo(id: string): { chapter: string; badge: string } {
  const match = id.match(/^lesson(\d+)p(\d+)$/);
  if (!match) return { chapter: "•", badge: "•" };
  return { chapter: match[1], badge: `${match[1]}.${match[2]}` };
}

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

  const chapters = new Map<string, typeof lessons>();
  for (const lesson of lessons) {
    const { chapter } = chapterInfo(lesson.id);
    chapters.set(chapter, [...(chapters.get(chapter) ?? []), lesson]);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Header streak={streak} />

      <h1 className="font-display text-4xl font-semibold tracking-tight">
        Your <span className="italic text-primary">lessons</span>
      </h1>
      <p className="mt-2 text-sm text-muted">
        Pick up where you left off — Sofía remembers every line.
      </p>

      {dbError && (
        <p className="mt-6 rounded-2xl bg-gold-soft p-4 text-sm text-gold">
          Progress database isn&apos;t reachable — lessons work, but progress won&apos;t be saved.
        </p>
      )}

      <div className="mt-10 space-y-12">
        {[...chapters.entries()].map(([chapter, chapterLessons]) => (
          <section key={chapter}>
            <div className="mb-4 flex items-center gap-4">
              <h2 className="font-display shrink-0 text-lg italic text-muted">
                {CHAPTER_NAMES[chapter] ?? `Chapter ${chapter}`}
              </h2>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {chapterLessons.map((lesson) => {
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
                    badge={chapterInfo(lesson.id).badge}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
