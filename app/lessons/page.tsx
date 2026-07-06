import Link from "next/link";
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

      <Link
        href="/practice"
        className="group mt-8 flex items-center justify-between gap-4 rounded-3xl border border-primary/30 p-6 shadow-warm transition hover:-translate-y-0.5"
        style={{
          background:
            "linear-gradient(120deg, var(--primary-soft), color-mix(in srgb, var(--gold-soft) 70%, var(--primary-soft)))",
        }}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-primary">
            Teacher mode
          </p>
          <p className="font-display mt-1 text-2xl font-semibold tracking-tight">
            Práctica <span className="italic text-primary">libre</span>
          </p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-muted">
            Free conversation with Sofía — she knows what you&apos;ve learned, drills your weak
            spots, proposes roleplays, and suggests your next lesson.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white shadow-warm transition group-hover:bg-primary-strong">
          Just talk →
        </span>
      </Link>

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
