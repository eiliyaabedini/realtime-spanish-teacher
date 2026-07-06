import Link from "next/link";

export type LessonCardProps = {
  id: string;
  title: string;
  description?: string;
  totalPairs: number;
  correctLines: number;
  resumeIndex: number;
  /** e.g. "1.2" — derived from the lesson id */
  badge: string;
};

export function LessonCard({
  id,
  title,
  description,
  totalPairs,
  correctLines,
  resumeIndex,
  badge,
}: LessonCardProps) {
  const complete = totalPairs > 0 && correctLines >= totalPairs;
  const started = resumeIndex > 0 && !complete;
  const pct = totalPairs > 0 ? Math.min(100, Math.round((correctLines / totalPairs) * 100)) : 0;

  return (
    <Link
      href={`/lessons/${id}`}
      className="group flex flex-col gap-2.5 rounded-3xl border border-line bg-surface p-5 shadow-warm transition hover:-translate-y-1 hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-lg italic text-muted/80">{badge}</span>
          <h2 className="font-medium leading-snug group-hover:text-primary">{title}</h2>
        </div>
        {complete ? (
          <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
            ✓ Done
          </span>
        ) : started ? (
          <span className="shrink-0 rounded-full bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary">
            Line {Math.min(resumeIndex + 1, totalPairs)}/{totalPairs}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
            Start
          </span>
        )}
      </div>
      {description && <p className="text-sm leading-relaxed text-muted">{description}</p>}
      <div className="mt-auto pt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full transition-all ${complete ? "bg-accent" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {correctLines}/{totalPairs} lines
        </p>
      </div>
    </Link>
  );
}
