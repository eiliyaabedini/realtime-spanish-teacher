import Link from "next/link";

export function Header({ streak }: { streak?: number }) {
  return (
    <header className="mb-8 flex items-center justify-between">
      <Link href="/lessons" className="text-lg font-semibold">
        Realtime Spanish Teacher
      </Link>
      <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        {typeof streak === "number" && streak > 0 && (
          <span title={`${streak}-day streak`} className="font-medium text-orange-500">
            🔥 {streak}
          </span>
        )}
        <Link href="/lessons" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Lessons
        </Link>
        <Link href="/memory" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Memory
        </Link>
        <Link href="/settings" className="hover:text-zinc-900 dark:hover:text-zinc-100">
          Settings
        </Link>
        <form action="/auth/signout" method="post">
          <button className="hover:text-zinc-900 dark:hover:text-zinc-100">Sign out</button>
        </form>
      </nav>
    </header>
  );
}
