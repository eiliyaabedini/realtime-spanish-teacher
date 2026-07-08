"use client";

import { useState } from "react";
import { REALTIME_MODELS } from "@/lib/realtime/models";
import { REALTIME_VOICES } from "@/lib/realtime/voices";
import type { SettingsStatus } from "@/lib/settings";

export function SettingsForm({ initial }: { initial: SettingsStatus }) {
  const [settings, setSettings] = useState<SettingsStatus>(initial);
  const [apiKey, setApiKey] = useState("");
  const [voice, setVoice] = useState(initial.voice);
  const [model, setModel] = useState(initial.model);
  const [lessonMode, setLessonMode] = useState(initial.lessonMode);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const body: Record<string, string | number> = { voice, model, lessonMode };
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
    <form onSubmit={save} className="mt-8 space-y-6">
      {settings.dbError && (
        <p className="rounded-2xl bg-gold-soft p-4 text-sm text-gold">
          Database unreachable — settings can&apos;t be loaded or saved right now.
        </p>
      )}

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-warm">
        <h2 className="font-display text-lg font-semibold">OpenAI API key</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Voice lessons run on OpenAI&apos;s Realtime API. Your key is stored encrypted and only
          used server-side to start your sessions.
        </p>
        <p
          className={`mt-3 text-sm font-medium ${
            !settings.hasOwnKey && !settings.serverHasKey ? "text-error" : "text-accent"
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
          className="mt-3 w-full rounded-xl border border-line bg-background px-4 py-3 font-mono text-sm outline-none transition focus:border-primary"
        />
        {settings.hasOwnKey && (
          <button
            type="button"
            onClick={removeKey}
            className="mt-2 text-sm text-error hover:underline"
          >
            Remove my key
          </button>
        )}
      </section>

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-warm">
        <h2 className="font-display text-lg font-semibold">Sofía&apos;s brain</h2>
        <p className="mt-1 text-sm text-muted">
          Economy is ~3× cheaper on audio and plenty smart for repeat-after-me lessons. Takes
          effect on your next session.
        </p>
        <div className="mt-3 space-y-2">
          {REALTIME_MODELS.map((m) => (
            <label
              key={m.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                model === m.id ? "border-primary bg-primary-soft/50" : "border-line hover:bg-surface-2"
              }`}
            >
              <input
                type="radio"
                name="model"
                checked={model === m.id}
                onChange={() => setModel(m.id)}
                className="mt-1 accent-[var(--primary)]"
              />
              <span>
                <span className="block text-sm font-medium">{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-warm">
        <h2 className="font-display text-lg font-semibold">Teaching style</h2>
        <p className="mt-1 text-sm text-muted">
          Natural flow feels like a real conversation — Sofía teaches each phrase warmly, one at a
          time. Line-by-line is the strict repeat-after-me drill.
        </p>
        <div className="mt-3 space-y-2">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              lessonMode === "natural"
                ? "border-primary bg-primary-soft/50"
                : "border-line hover:bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="lessonMode"
              checked={lessonMode === "natural"}
              onChange={() => setLessonMode("natural")}
              className="mt-1 accent-[var(--primary)]"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">Natural flow</span>
              <span className="block text-xs text-muted">
                Warm conversation — Sofía teaches one phrase at a time and reacts to how you do
              </span>
            </span>
          </label>
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
              lessonMode === "lines"
                ? "border-primary bg-primary-soft/50"
                : "border-line hover:bg-surface-2"
            }`}
          >
            <input
              type="radio"
              name="lessonMode"
              checked={lessonMode === "lines"}
              onChange={() => setLessonMode("lines")}
              className="mt-1 accent-[var(--primary)]"
            />
            <span>
              <span className="block text-sm font-medium">Line-by-line</span>
              <span className="block text-xs text-muted">
                Strict script order with per-line grading — precise, like the Android app
              </span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-surface p-6 shadow-warm">
        <h2 className="font-display text-lg font-semibold">Sofía&apos;s voice</h2>
        <p className="mt-1 text-sm text-muted">Takes effect the next time you start a lesson.</p>
        <select
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          className="mt-3 w-full rounded-xl border border-line bg-background px-4 py-3 text-sm outline-none transition focus:border-primary"
        >
          {REALTIME_VOICES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </section>

      {message && (
        <p className={`text-sm ${message.kind === "ok" ? "text-accent" : "text-error"}`}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="rounded-full bg-primary px-8 py-3 text-sm font-medium text-white shadow-warm transition hover:bg-primary-strong disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
