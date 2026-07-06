"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/lessons";
  const authError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function signInWithGoogle() {
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setErrorMsg(error.message);
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-320px] h-[560px] w-[560px] -translate-x-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--gold) 70%, transparent) 0%, transparent 65%)",
        }}
      />
      <div className="relative w-full max-w-sm rounded-3xl border border-line bg-surface p-8 shadow-warm">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-gold" />
        <h1 className="font-display mt-3 text-3xl font-semibold tracking-tight">
          Hola, I&apos;m <span className="italic text-primary">Sofía</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Sign in to start your lesson. I remember your progress and how you learn best.
        </p>

        {(authError || errorMsg) && (
          <p className="mt-4 rounded-xl bg-error-soft p-3 text-sm text-error">
            {errorMsg ?? "Sign-in failed. Please try again."}
          </p>
        )}

        <button
          onClick={signInWithGoogle}
          className="mt-6 w-full rounded-xl border border-line bg-surface px-4 py-3 text-sm font-medium transition hover:bg-surface-2"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-line" />
          or
          <div className="h-px flex-1 bg-line" />
        </div>

        {status === "sent" ? (
          <p className="rounded-xl bg-accent-soft p-3 text-sm text-accent">
            Check your email — we sent you a sign-in link.
          </p>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl border border-line bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-medium text-white transition hover:bg-primary-strong disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
