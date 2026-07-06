import Link from "next/link";
import { Header } from "@/components/Header";
import { JourneyGuide, type NextStepView } from "@/components/JourneyGuide";
import { Teacher } from "@/components/Teacher";
import { getStreak } from "@/lib/db/queries";
import { computeNextStep, type NextStep } from "@/lib/guide/journey";
import { getLessonIndex } from "@/lib/lessons/catalog";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function toView(step: NextStep): NextStepView {
  if (step.kind === "practice") {
    return {
      href: "/practice?autostart=1",
      label: "Practice with Sofía",
      detail:
        step.reason === "all_done"
          ? "Every lesson is complete — conversation is the goal now."
          : "You just finished a lesson — use it in a real conversation before the next one.",
    };
  }
  const badge = step.lessonId.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
  if (step.mode === "continue") {
    return {
      href: `/lessons/${step.lessonId}?autostart=1`,
      label: `Continue ${badge} ${step.title}`,
      detail: `You're at line ${Math.min(step.resumeLine + 1, step.totalPairs)} of ${step.totalPairs} — pick up right where you left off.`,
    };
  }
  return {
    href: `/lessons/${step.lessonId}?autostart=1`,
    label: step.mode === "first" ? `Start your first lesson` : `Start ${badge} ${step.title}`,
    detail:
      step.mode === "first"
        ? "Sofía speaks, you repeat, she coaches — that's the whole method."
        : "You practiced what you learned — time for new material.",
  };
}

export default async function Home() {
  const user = await getUser();

  if (!user) {
    return <Marketing />;
  }

  let step: NextStep = {
    kind: "lesson",
    lessonId: getLessonIndex()[0]?.id ?? "lesson1p1",
    title: getLessonIndex()[0]?.title ?? "Introductions",
    mode: "first",
    resumeLine: 0,
    totalPairs: 0,
  };
  let streak = 0;
  try {
    [step, streak] = await Promise.all([computeNextStep(user.id), getStreak(user.id)]);
  } catch {
    // DB down — default to the first lesson
  }

  const firstName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    (user.user_metadata?.name as string | undefined)?.split(" ")[0] ??
    null;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-8">
      <Header streak={streak} />
      <main className="flex flex-1 flex-col items-center justify-center pb-16">
        <JourneyGuide
          firstName={firstName}
          lessonIndex={getLessonIndex().map((l) => ({ id: l.id, title: l.title }))}
          nextStep={toView(step)}
        />
      </main>
    </div>
  );
}

function Marketing() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      <div
        aria-hidden
        className="hero-sun pointer-events-none absolute left-1/2 top-[-260px] h-[560px] w-[560px] rounded-full opacity-90"
        style={{
          background:
            "radial-gradient(circle, var(--gold) 0%, color-mix(in srgb, var(--gold) 35%, transparent) 38%, transparent 68%)",
        }}
      />

      <div className="relative">
        <Teacher state="idle" size={132} />
      </div>

      <p className="relative mb-5 rounded-full border border-line bg-surface px-4 py-1.5 text-xs font-medium uppercase tracking-[0.2em] text-primary shadow-warm">
        Aprende español hablando
      </p>

      <h1 className="font-display relative max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">
        Speak Spanish
        <br />
        <span className="italic text-primary">from the first minute</span>
      </h1>

      <p className="relative mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted">
        A live voice conversation with Profesora Sofía — she speaks, listens, corrects you gently
        in plain English, and remembers exactly how you learn. Lesson by lesson.
      </p>

      <Link
        href="/lessons"
        className="relative mt-10 rounded-full bg-primary px-10 py-4 text-lg font-medium text-white shadow-warm transition hover:-translate-y-0.5 hover:bg-primary-strong"
      >
        Start speaking →
      </Link>

      <div className="relative mt-12 flex flex-wrap items-center justify-center gap-2 text-sm text-muted">
        {["🎙️ Real conversation", "📖 16 scripted lessons", "🧠 A teacher who remembers you"].map(
          (chip) => (
            <span key={chip} className="rounded-full border border-line bg-surface px-4 py-1.5">
              {chip}
            </span>
          ),
        )}
      </div>
    </main>
  );
}
