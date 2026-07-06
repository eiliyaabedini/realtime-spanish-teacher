"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Teacher } from "@/components/Teacher";
import { PracticeFeed } from "@/components/widgets/PracticeFeed";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime/connection";
import {
  PracticeOrchestrator,
  type LessonSuggestion,
  type PracticeSnapshot,
} from "@/lib/realtime/practice-orchestrator";

type Props = {
  lessonIndex: { id: string; title: string }[];
  autostart?: boolean;
  /** set when the student paused a lesson to talk it through */
  from?: { lessonId: string; lineIndex: number; title: string } | null;
};

type Status = "idle" | "starting" | "active" | "error";

const PHASE_LABEL: Record<PracticeSnapshot["phase"], string> = {
  connecting: "Connecting…",
  speaking: "Sofía is speaking…",
  listening: "Your turn — just talk",
  complete: "Session complete",
  error: "Connection problem",
};

const EMPTY_SNAPSHOT: PracticeSnapshot = {
  phase: "connecting",
  messages: [],
  feed: [],
  suggestions: [],
  micActive: false,
  stats: { turnLatenciesMs: [], driftScores: [], usdCost: 0, inputTokens: 0, outputTokens: 0 },
  error: null,
  warning: null,
};

export function PracticeSession({ lessonIndex, autostart, from }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);
  const orchRef = useRef<PracticeOrchestrator | null>(null);
  const autostarted = useRef(false);

  useEffect(() => {
    return () => {
      orchRef.current?.stop();
      connRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (autostart && !autostarted.current) {
      autostarted.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart]);

  const subscribe = useCallback((cb: () => void) => {
    return orchRef.current ? orchRef.current.subscribe(cb) : () => {};
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps -- re-subscribe once the orchestrator exists

  const getSnapshot = useCallback((): PracticeSnapshot => {
    return orchRef.current ? orchRef.current.getSnapshot() : EMPTY_SNAPSHOT;
  }, []);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  async function start() {
    setStatus("starting");
    setStartError(null);
    setNeedsKey(false);

    try {
      const res = await fetch("/api/realtime/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "practice",
          ...(from ? { from: { lessonId: from.lessonId, lineIndex: from.lineIndex } } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "no_api_key") setNeedsKey(true);
        throw new Error(data?.message ?? "Could not start the session.");
      }

      const orchestrator = new PracticeOrchestrator({
        send: (event) => connRef.current?.send(event),
        lessonIndex,
        hooks: {
          postMemory: async (entry) => {
            await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry),
            });
          },
          fetchLesson: async (lessonId) => {
            const r = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}`);
            if (!r.ok) return null;
            return (await r.json()) as {
              title: string;
              pairs: { teacher: string; student: string }[];
            };
          },
          onComplete: () => {
            void fetch("/api/practice/complete", { method: "POST" }).catch(() => {});
            void fetch("/api/memory/summarize", { method: "POST" }).catch(() => {});
          },
        },
      });
      orchRef.current = orchestrator;

      const connection = await connectRealtime({
        clientSecret: data.clientSecret,
        audioElement: audioRef.current!,
        onEvent: (ev) => orchRef.current?.handleServerEvent(ev),
        onAudioBlocked: () => setAudioBlocked(true),
        onConnectionChange: (state) => {
          if (state === "failed" || state === "disconnected") {
            setStartError("Connection lost — start a new practice session any time.");
            setStatus("error");
          }
        },
      });
      connRef.current = connection;
      if (!connection.micAvailable) setTextMode(true);
      setStatus("active");
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Could not start the session.");
      setStatus("error");
    }
  }

  function endSession() {
    // graceful: Sofía wraps up, completion panel takes over
    orchRef.current?.requestWrapUp();
  }

  function leaveNow() {
    orchRef.current?.stop();
    connRef.current?.close();
    connRef.current = null;
    window.location.href = "/lessons";
  }

  function toggleMute() {
    const next = !micMuted;
    setMicMuted(next);
    connRef.current?.setMicEnabled(!next);
  }

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    orchRef.current?.submitText(textInput);
    setTextInput("");
  }

  const complete = snap.phase === "complete";

  return (
    <div className="flex h-screen flex-col">
      <audio ref={audioRef} hidden />

      {/* top bar */}
      <div className="border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="min-w-0">
            <Link href="/lessons" className="text-xs text-muted transition hover:text-primary">
              ← All lessons
            </Link>
            <h1 className="font-display truncate text-lg font-semibold tracking-tight">
              Práctica <span className="italic text-primary">libre</span>
            </h1>
          </div>
          {status === "active" && !complete && (
            <div className="flex shrink-0 items-center gap-2">
              {!textMode && (
                <button
                  onClick={toggleMute}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    micMuted
                      ? "border-error/40 bg-error-soft text-error"
                      : "border-line hover:bg-surface-2"
                  }`}
                >
                  {micMuted ? "🔇 Muted" : "Mute"}
                </button>
              )}
              <button
                onClick={endSession}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium transition hover:bg-surface-2"
              >
                Wrap up
              </button>
            </div>
          )}
        </div>
      </div>

      {snap.warning && (
        <p className="bg-gold-soft px-4 py-2 text-center text-xs text-gold">{snap.warning}</p>
      )}
      {from && !complete && (
        <div className="bg-primary-soft px-4 py-2 text-center text-xs">
          <Link
            href={`/lessons/${from.lessonId}?autostart=1`}
            className="font-medium text-primary hover:underline"
          >
            ↩ Resume lesson: {from.title} (line {from.lineIndex + 1})
          </Link>
        </div>
      )}

      {/* feed (chat + whiteboard widgets) + suggestions */}
      <div className="flex-1 overflow-y-auto">
        <PracticeFeed
          feed={snap.feed}
          teacherSpeaking={status === "active" && snap.phase === "speaking"}
          onWidgetResult={(summary) => orchRef.current?.sendWidgetResult(summary)}
        />
        {snap.suggestions.length > 0 && (
          <div className="mx-auto max-w-2xl space-y-2 px-4 pb-6">
            {snap.suggestions.map((s) => (
              <SuggestionCard key={s.lessonId} suggestion={s} />
            ))}
          </div>
        )}
      </div>

      {/* bottom dock */}
      <div className="border-t border-line bg-surface/80 px-5 py-5 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {complete ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <Teacher state="happy" size={96} />
              <p className="font-display text-3xl font-semibold tracking-tight">
                ¡Buen <span className="italic text-primary">trabajo!</span> 🎉
              </p>
              <p className="text-sm text-muted">
                Sofía updated what she knows about you
                {snap.stats.usdCost > 0 && <> · session ≈ ${snap.stats.usdCost.toFixed(2)}</>}
              </p>
              <div className="mt-1 flex gap-3">
                <Link
                  href="/lessons"
                  className="rounded-full border border-line px-6 py-2.5 text-sm font-medium transition hover:bg-surface-2"
                >
                  All lessons
                </Link>
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-warm transition hover:bg-primary-strong"
                >
                  Practice again
                </button>
              </div>
            </div>
          ) : status === "idle" || status === "starting" ? (
            <div className="flex flex-col items-center gap-3">
              <Teacher state="idle" size={104} />
              <button
                onClick={start}
                disabled={status === "starting"}
                className="rounded-full bg-primary px-12 py-4 text-lg font-medium text-white shadow-warm transition hover:-translate-y-0.5 hover:bg-primary-strong disabled:translate-y-0 disabled:opacity-60"
              >
                {status === "starting" ? "Connecting…" : "Start practicing"}
              </button>
              <p className="max-w-md text-center text-xs leading-relaxed text-muted">
                Free conversation with Sofía. She knows exactly what you&apos;ve learned, where you
                struggle, and what to practice next — just talk.
              </p>
            </div>
          ) : status === "error" || snap.phase === "error" ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-error">
                {startError ?? snap.error ?? "Something went wrong."}
              </p>
              {needsKey ? (
                <Link
                  href="/settings"
                  className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-white transition hover:bg-primary-strong"
                >
                  Add your OpenAI key in Settings
                </Link>
              ) : (
                <button
                  onClick={() => window.location.reload()}
                  className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-white transition hover:bg-primary-strong"
                >
                  Start a new session
                </button>
              )}
              <button onClick={leaveNow} className="text-xs text-muted hover:underline">
                Back to lessons
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-5">
              <Teacher
                state={
                  snap.micActive ? "listening" : snap.phase === "speaking" ? "speaking" : "listening"
                }
                audioRef={audioRef}
                size={104}
              />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {snap.micActive && (
                    <span className="mic-live inline-block h-2 w-2 rounded-full bg-error" />
                  )}
                  {snap.micActive ? "I can hear you…" : PHASE_LABEL[snap.phase]}
                </p>
                {audioBlocked && (
                  <button
                    onClick={() =>
                      void audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {})
                    }
                    className="mt-1 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white shadow-warm"
                  >
                    🔊 Tap to hear Sofía
                  </button>
                )}
                {textMode ? (
                  <form onSubmit={submitText} className="mt-2 flex w-72 max-w-full gap-2">
                    <input
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Type in Spanish or English…"
                      className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    />
                    <button className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-strong">
                      Send
                    </button>
                  </form>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">
                    Ask for a roleplay, a review, or just chat — she adapts to you.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: LessonSuggestion }) {
  const badge = suggestion.lessonId.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
  return (
    <div className="bubble-in flex items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary-soft p-4 shadow-warm">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          Sofía suggests
        </p>
        <p className="mt-0.5 font-medium">
          <span className="font-display italic text-muted">{badge}</span> {suggestion.title}
        </p>
        <p className="mt-0.5 text-sm text-muted">“{suggestion.reason}”</p>
      </div>
      <Link
        href={`/lessons/${suggestion.lessonId}?autostart=1`}
        className="shrink-0 rounded-full bg-primary px-5 py-2 text-sm font-medium text-white transition hover:bg-primary-strong"
      >
        Start →
      </Link>
    </div>
  );
}
