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
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Header />
      <h1 className="font-display text-4xl font-semibold tracking-tight">
        What Sofía <span className="italic text-primary">knows about you</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Observations she saved to personalize your lessons. Delete anything — she forgets it
        immediately.
      </p>

      {dbError && (
        <p className="mt-6 rounded-2xl bg-gold-soft p-4 text-sm text-gold">
          Database unreachable — try again shortly.
        </p>
      )}

      <div className="mt-8">
        <MemoryList items={items} />
      </div>

      {stats && stats.totalAttempts > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
            Computed from your practice — not stored, always current
          </h2>
          <div className="rounded-3xl border border-line bg-surface p-5 text-sm shadow-warm">
            <p className="font-medium">
              {stats.totalAttempts} total attempts
              {stats.accuracy !== null && (
                <span className="text-accent"> · {Math.round(stats.accuracy * 100)}% correct</span>
              )}
            </p>
            {stats.strugglingLines.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-muted">
                {stats.strugglingLines.map((s) => {
                  const phrase = getLessonPairs(s.lessonId)[s.lineIndex]?.student;
                  return phrase ? (
                    <li key={`${s.lessonId}-${s.lineIndex}`}>
                      <span className="text-primary">«{phrase}»</span> — missed {s.failCount} times
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
