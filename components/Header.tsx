import Link from "next/link";

export function Header({ streak }: { streak?: number }) {
  return (
    <header className="mb-10 flex items-center justify-between">
      <Link href="/lessons" className="group flex items-baseline gap-2">
        <span className="inline-block h-2.5 w-2.5 self-center rounded-full bg-gold" />
        <span className="font-display text-xl italic tracking-tight group-hover:text-primary">
          Profesora Sofía
        </span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {typeof streak === "number" && streak > 0 && (
          <span
            title={`${streak}-day streak`}
            className="mr-2 rounded-full bg-gold-soft px-3 py-1 font-medium text-gold"
          >
            🔥 {streak}
          </span>
        )}
        <NavLink href="/lessons">Lessons</NavLink>
        <NavLink href="/memory">Memory</NavLink>
        <NavLink href="/settings">Settings</NavLink>
        <form action="/auth/signout" method="post">
          <button className="rounded-full px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-ink">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full px-3 py-1.5 text-muted transition hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
