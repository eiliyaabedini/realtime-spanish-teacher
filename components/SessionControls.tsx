"use client";

// Call-style controls that sit under Sofía during a live session.

export function CircleButton({
  icon,
  label,
  onClick,
  variant = "neutral",
  active = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: "neutral" | "danger";
  active?: boolean;
}) {
  const face =
    variant === "danger"
      ? "border-error/40 bg-error-soft text-error hover:bg-error/20"
      : active
        ? "border-error/40 bg-error-soft text-error"
        : "border-line bg-surface hover:bg-surface-2";
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <button
        onClick={onClick}
        aria-label={label}
        className={`flex h-13 w-13 items-center justify-center rounded-full border text-xl shadow-warm transition hover:-translate-y-0.5 ${face}`}
        style={{ height: 52, width: 52 }}
      >
        {icon}
      </button>
      <span className="text-[11px] font-medium text-muted">{label}</span>
    </div>
  );
}

export function PillButton({
  icon,
  label,
  caption,
  onClick,
}: {
  icon: string;
  label: string;
  caption?: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        className="flex items-center gap-2 rounded-full border border-primary/40 bg-primary-soft px-5 py-3 text-sm font-semibold text-primary shadow-warm transition hover:-translate-y-0.5 hover:bg-primary/20"
      >
        <span className="text-lg">{icon}</span>
        {label}
      </button>
      {caption && <span className="text-[11px] font-medium text-muted">{caption}</span>}
    </div>
  );
}
