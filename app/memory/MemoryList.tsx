"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type MemoryItem = {
  id: number;
  category: string;
  observation: string;
  createdAt: string;
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
      <p className="rounded-xl border border-dashed border-black/15 p-6 text-center text-sm text-zinc-500 dark:border-white/15">
        Nothing yet. As you take lessons, your teacher saves observations about how you learn —
        they&apos;ll appear here, and you can delete any of them.
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
    <div className="space-y-6">
      {[...byCategory.entries()].map(([category, list]) => (
        <section key={category}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {category}
          </h2>
          <ul className="space-y-2">
            {list.map((item) => (
              <li
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-black/10 bg-white p-3 text-sm dark:border-white/10 dark:bg-zinc-900"
              >
                <div>
                  <p>{item.observation}</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => remove(item.id)}
                  disabled={busy}
                  className="text-xs text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
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
        className="text-sm text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
      >
        Forget everything
      </button>
    </div>
  );
}
