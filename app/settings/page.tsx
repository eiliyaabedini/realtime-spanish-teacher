import { Header } from "@/components/Header";
import {
  getRecentUsage,
  getUsageSummary,
  type UsageRow,
  type UsageSummary,
} from "@/lib/db/queries";
import { getSettingsStatus } from "@/lib/settings";
import { getUser } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

const MODE_LABELS: Record<string, string> = {
  lesson: "📖 Lessons",
  practice: "🗣️ Practice",
  guide: "☀️ Welcome chats",
};

export default async function SettingsPage() {
  const user = await getUser();
  const status = user
    ? await getSettingsStatus(user.id)
    : {
        voice: "marin",
        model: "gpt-realtime-2",
        lessonMode: "natural",
        chunkSize: 20,
        hasOwnKey: false,
        keyHint: null,
        serverHasKey: false,
        dbError: true,
      };

  let usage: UsageSummary | null = null;
  let recent: UsageRow[] = [];
  if (user) {
    try {
      [usage, recent] = await Promise.all([getUsageSummary(user.id), getRecentUsage(user.id)]);
    } catch {
      // spending card simply hidden when the DB is unreachable
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <Header />
      <h1 className="font-display text-4xl font-semibold tracking-tight">
        <span className="italic text-primary">Settings</span>
      </h1>

      {usage && usage.sessions === 0 && (
        <section className="mt-8 rounded-3xl border border-dashed border-line bg-surface p-6">
          <h2 className="font-display text-lg font-semibold">Spending</h2>
          <p className="mt-2 text-sm text-muted">
            No sessions recorded yet — your next lesson or practice chat will appear here with
            its estimated cost, and totals will build up over time.
          </p>
        </section>
      )}

      {usage && usage.sessions > 0 && (
        <section className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-warm">
          <h2 className="font-display text-lg font-semibold">Spending</h2>
          <div className="mt-3 flex items-baseline gap-6">
            <div>
              <p className="font-display text-3xl font-semibold tracking-tight">
                ${usage.totalUsd.toFixed(2)}
              </p>
              <p className="text-xs text-muted">all time · {usage.sessions} sessions</p>
            </div>
            <div>
              <p className="font-display text-3xl font-semibold tracking-tight text-primary">
                ${usage.last30dUsd.toFixed(2)}
              </p>
              <p className="text-xs text-muted">last 30 days</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {usage.byMode.map((m) => (
              <li key={m.mode} className="flex items-center justify-between text-muted">
                <span>{MODE_LABELS[m.mode] ?? m.mode}</span>
                <span>
                  ${m.usd.toFixed(2)} · {m.sessions}×
                </span>
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <>
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
                Recent sessions
              </h3>
              <ul className="mt-2 divide-y divide-line/60 text-sm">
                {recent.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-muted">
                      {MODE_LABELS[r.mode] ?? r.mode} ·{" "}
                      {r.createdAt.toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {r.seconds > 0 && <> · {Math.round(r.seconds / 60)}m</>}
                    </span>
                    <span className="shrink-0 font-medium">${r.usd.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-3 text-xs text-muted">
            Client-side estimates from token usage — exact billing lives at
            platform.openai.com/usage.
          </p>
        </section>
      )}

      <SettingsForm initial={status} />
    </div>
  );
}
