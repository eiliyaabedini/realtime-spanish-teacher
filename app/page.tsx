import Link from "next/link";
import { Teacher } from "@/components/Teacher";

export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center">
      {/* warm sun glow */}
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
