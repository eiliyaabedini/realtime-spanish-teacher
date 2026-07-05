import { Header } from "@/components/Header";
import { getDerivedStats, listMemory, type DerivedStats } from "@/lib/db/queries";
import { getLessonPairs } from "@/lib/lessons/catalog";
import { getUser } from "@/lib/supabase/server";
import { MemoryList, type MemoryItem } from "./MemoryList";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const user = await getUser();

  let items: MemoryItem[] = [];
  let stats: DerivedStats | null = null;
  let dbError = false;
  if (user) {
    try {
      const [rows, derived] = await Promise.all([listMemory(user.id), getDerivedStats(user.id)]);
      items = rows.map((r) => ({
        id: r.id,
        category: r.category,
        observation: r.observation,
        createdAt: r.createdAt.toISOString(),
      }));
      stats = derived;
    } catch {
      dbError = true;
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Header />
      <h1 className="text-2xl font-semibold">What your teacher knows about you</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Observations your teacher saved to personalize your lessons. Delete anything — the teacher
        forgets it immediately.
      </p>

      {dbError && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Database unreachable — try again shortly.
        </p>
      )}

      <div className="mt-6">
        <MemoryList items={items} />
      </div>

      {stats && stats.totalAttempts > 0 && (
        <section className="mt-10">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Computed from your practice (not stored, always current)
          </h2>
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm dark:border-white/10 dark:bg-zinc-900">
            <p>
              {stats.totalAttempts} total attempts
              {stats.accuracy !== null && <> · {Math.round(stats.accuracy * 100)}% correct</>}
            </p>
            {stats.strugglingLines.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-zinc-600 dark:text-zinc-400">
                {stats.strugglingLines.map((s) => {
                  const phrase = getLessonPairs(s.lessonId)[s.lineIndex]?.student;
                  return phrase ? (
                    <li key={`${s.lessonId}-${s.lineIndex}`}>
                      «{phrase}» — missed {s.failCount} times
                    </li>
                  ) : null;
                })}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
