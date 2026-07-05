import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="text-sm font-medium uppercase tracking-widest text-indigo-500">
        Aprende español hablando
      </p>
      <h1 className="max-w-2xl text-4xl font-bold sm:text-5xl">
        A real conversation with a teacher who remembers you
      </h1>
      <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
        Live voice lessons powered by realtime AI. Your teacher speaks, listens, corrects you
        gently in plain English, and adapts to how you learn — lesson by lesson.
      </p>
      <Link
        href="/lessons"
        className="rounded-full bg-indigo-600 px-8 py-3 text-lg font-medium text-white hover:bg-indigo-500"
      >
        Start learning →
      </Link>
      <p className="text-xs text-zinc-400">16 scripted lessons · voice-first · progress saved</p>
    </main>
  );
}
