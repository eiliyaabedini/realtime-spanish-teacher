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
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold">Realtime Spanish Teacher</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to start your lesson. Your teacher remembers your progress and how you learn.
        </p>

        {(authError || errorMsg) && (
          <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {errorMsg ?? "Sign-in failed. Please try again."}
          </p>
        )}

        <button
          onClick={signInWithGoogle}
          className="mt-6 w-full rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm font-medium hover:bg-zinc-50 dark:border-white/15 dark:bg-zinc-800 dark:hover:bg-zinc-700"
        >
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
          or
          <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
        </div>

        {status === "sent" ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
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
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-white/15 dark:bg-zinc-800"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
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
