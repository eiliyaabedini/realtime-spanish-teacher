"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type MemoryItem = {
  id: number;
  category: string;
  observation: string;
  createdAt: string;
};

const CATEGORY_ICONS: Record<string, string> = {
  grammar: "🧩",
  vocab: "📚",
  pronunciation: "🗣️",
  pace: "⏱️",
  style: "🎨",
};

export function MemoryList({ items }: { items: MemoryItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove(id?: number) {
    setBusy(true);
    const url = id ? `/api/memory?id=${id}` : "/api/memory?all=1";
    await fetch(url, { method: "DELETE" }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-line bg-surface p-8 text-center text-sm leading-relaxed text-muted">
        Nothing yet. As you take lessons, Sofía saves observations about how you learn — they&apos;ll
        appear here, and you can delete any of them.
      </p>
    );
  }

  const byCategory = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  return (
    <div className="space-y-8">
      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category}>
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-display shrink-0 text-base italic text-muted">
              {CATEGORY_ICONS[category] ?? "•"} {category}
            </h2>
            <div className="h-px flex-1 bg-line" />
          </div>
          <ul className="space-y-2">
            {list.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-4 rounded-2xl border border-line bg-surface p-4 text-sm shadow-warm"
              >
                <div>
                  <p className="leading-relaxed">{item.observation}</p>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => remove(item.id)}
                  disabled={busy}
                  className="shrink-0 text-xs text-error hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <button
        onClick={() => remove()}
        disabled={busy}
        className="text-sm text-error hover:underline disabled:opacity-50"
      >
        Forget everything
      </button>
    </div>
  );
}
