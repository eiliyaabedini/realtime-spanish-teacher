"use client";

import { useState } from "react";
import { REALTIME_VOICES } from "@/lib/realtime/voices";
import type { SettingsStatus } from "@/lib/settings";

export function SettingsForm({ initial }: { initial: SettingsStatus }) {
  const [settings, setSettings] = useState<SettingsStatus>(initial);
  const [apiKey, setApiKey] = useState("");
  const [voice, setVoice] = useState(initial.voice);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const body: Record<string, string> = { voice };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      setSettings(data as SettingsStatus);
      setApiKey("");
      setMessage({ kind: "ok", text: "Saved." });
    } else {
      setMessage({ kind: "error", text: data?.error ?? "Could not save settings." });
    }
  }

  async function removeKey() {
    setMessage(null);
    const res = await fetch("/api/settings", { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (res.ok && data) {
      setSettings(data as SettingsStatus);
      setMessage({ kind: "ok", text: "Your API key was removed." });
    }
  }

  const keyStatus = settings.hasOwnKey
    ? `Using your key (ends in …${settings.keyHint})`
    : settings.serverHasKey
      ? "Using this app's shared key"
      : "No API key configured — lessons can't start yet";

  return (
    <form onSubmit={save} className="mt-6 space-y-8">
      {settings.dbError && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Database unreachable — settings can&apos;t be loaded or saved right now.
        </p>
      )}

      <section className="rounded-2xl border border-black/10 p-5 dark:border-white/10">
        <h2 className="font-medium">OpenAI API key</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Voice lessons run on OpenAI&apos;s Realtime API. Your key is stored encrypted and only
          used server-side to start your sessions.
        </p>
        <p
          className={`mt-3 text-sm font-medium ${
            !settings.hasOwnKey && !settings.serverHasKey
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-700 dark:text-emerald-400"
          }`}
        >
          {keyStatus}
        </p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
          className="mt-3 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-400 dark:border-white/15 dark:bg-zinc-800"
        />
        {settings.hasOwnKey && (
          <button
            type="button"
            onClick={removeKey}
            className="mt-2 text-sm text-red-600 hover:underline dark:text-red-400"
          >
            Remove my key
          </button>
        )}
      </section>

      <section className="rounded-2xl border border-black/10 p-5 dark:border-white/10">
        <h2 className="font-medium">Teacher voice</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Takes effect the next time you start a lesson.
        </p>
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="mt-3 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm dark:border-white/15 dark:bg-zinc-800"
        >
          {REALTIME_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </section>

      {message && (
        <p
          className={`text-sm ${
            message.kind === "ok"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
