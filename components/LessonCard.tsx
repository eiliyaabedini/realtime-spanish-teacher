import Link from "next/link";

export type LessonCardProps = {
  id: string;
  title: string;
  description?: string;
  totalPairs: number;
  correctLines: number;
  resumeIndex: number;
};

export function LessonCard({
  id,
  title,
  description,
  totalPairs,
  correctLines,
  resumeIndex,
}: LessonCardProps) {
  const complete = totalPairs > 0 && correctLines >= totalPairs;
  const started = resumeIndex > 0 && !complete;
  const pct = totalPairs > 0 ? Math.min(100, Math.round((correctLines / totalPairs) * 100)) : 0;

  return (
    <Link
      href={`/lessons/${id}`}
      className="group flex flex-col gap-2 rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:shadow dark:border-white/10 dark:bg-zinc-900 dark:hover:border-indigo-700"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
          {title}
        </h2>
        {complete ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Completed ✓
          </span>
        ) : started ? (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            Line {Math.min(resumeIndex + 1, totalPairs)}/{totalPairs}
          </span>
        ) : (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Start
          </span>
        )}
      </div>
      {description && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      )}
      <div className="mt-auto pt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${complete ? "bg-emerald-500" : "bg-indigo-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-zinc-400">
          {correctLines}/{totalPairs} lines
        </p>
      </div>
    </Link>
  );
}
