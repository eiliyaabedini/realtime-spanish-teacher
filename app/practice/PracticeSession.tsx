"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Teacher } from "@/components/Teacher";
import { GrammarTableWidget } from "@/components/widgets/GrammarTableWidget";
import { PracticeFeed } from "@/components/widgets/PracticeFeed";
import { QuizWidget } from "@/components/widgets/QuizWidget";
import { WordCardWidget } from "@/components/widgets/WordCardWidget";
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

/** how many of the latest widgets stay live on the stage */
const STAGE_WIDGETS = 2;

export function PracticeSession({ lessonIndex, autostart, from }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);
  const orchRef = useRef<PracticeOrchestrator | null>(null);
  const autostarted = useRef(false);

  const sessionStartedAt = useRef<number | null>(null);
  const usageSent = useRef(false);

  const sendUsageBeacon = useCallback(() => {
    const stats = orchRef.current?.getSnapshot().stats;
    if (!stats || usageSent.current || stats.usdCost <= 0) return;
    usageSent.current = true;
    void fetch("/api/usage-log", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "practice",
        usd: stats.usdCost,
        inputTokens: stats.inputTokens,
        outputTokens: stats.outputTokens,
        seconds: sessionStartedAt.current
          ? Math.round((Date.now() - sessionStartedAt.current) / 1000)
          : 0,
      }),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      sendUsageBeacon();
      orchRef.current?.stop();
      connRef.current?.close();
    };
  }, [sendUsageBeacon]);

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

  const getSnapshot = useCallback(
    (): PracticeSnapshot => orchRef.current?.getSnapshot() ?? EMPTY_SNAPSHOT,
    [],
  );
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

      sessionStartedAt.current = Date.now();
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
            sendUsageBeacon();
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

  const onWidgetResult = useCallback(
    (summary: string) => orchRef.current?.sendWidgetResult(summary),
    [],
  );

  const complete = snap.phase === "complete";
  const stageWidgets = snap.feed.filter((f) => f.kind === "widget").slice(-STAGE_WIDGETS);
  const lastTeacherLine = [...snap.messages].reverse().find((m) => m.role === "teacher")?.text;
  const teacherState = complete
    ? "happy"
    : snap.micActive
      ? "listening"
      : snap.phase === "speaking"
        ? "speaking"
        : "listening";

  return (
    <div className="flex h-screen flex-col">
      <audio ref={audioRef} hidden />

      {/* top bar */}
      <div className="border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="min-w-0">
            <Link href="/lessons" className="text-xs text-muted transition hover:text-primary">
              ← All lessons
            </Link>
            <h1 className="font-display truncate text-lg font-semibold tracking-tight">
              Práctica <span className="italic text-primary">libre</span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status === "active" && (
              <>
                {snap.stats.usdCost > 0.005 && (
                  <span
                    title="Estimated OpenAI cost this session"
                    className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted"
                  >
                    ≈${snap.stats.usdCost.toFixed(2)}
                  </span>
                )}
                <button
                  onClick={() => setShowTranscript((s) => !s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    showTranscript
                      ? "border-primary/40 bg-primary-soft text-primary"
                      : "border-line hover:bg-surface-2"
                  }`}
                >
                  💬 Transcript
                </button>
                {!complete && (
                  <>
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
                  </>
                )}
              </>
            )}
          </div>
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

      {/* ── the stage: Sofía front and center ─────────────────────────── */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 py-6">
          {status === "idle" || status === "starting" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <Teacher state="idle" size={190} />
              <button
                onClick={start}
                disabled={status === "starting"}
                className="mt-2 rounded-full bg-primary px-12 py-4 text-lg font-medium text-white shadow-warm transition hover:-translate-y-0.5 hover:bg-primary-strong disabled:translate-y-0 disabled:opacity-60"
              >
                {status === "starting" ? "Connecting…" : "Start practicing"}
              </button>
              <p className="max-w-md text-center text-xs leading-relaxed text-muted">
                Free conversation with Sofía. She knows exactly what you&apos;ve learned, shows
                cards and quizzes while you talk, and suggests what to do next.
              </p>
            </div>
          ) : status === "error" || snap.phase === "error" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Teacher state="oops" size={150} />
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
          ) : complete ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Teacher state="happy" size={170} />
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
          ) : (
            <>
              {/* Sofía + status — pinned feel at the top of the stage */}
              <div className="flex shrink-0 flex-col items-center">
                <Teacher state={teacherState} audioRef={audioRef} size={190} />
                <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                  {snap.micActive && (
                    <span className="mic-live inline-block h-2 w-2 rounded-full bg-error" />
                  )}
                  {snap.micActive
                    ? "I can hear you…"
                    : snap.phase === "speaking"
                      ? "Sofía is speaking…"
                      : "Your turn — just talk"}
                </p>
                {lastTeacherLine && (
                  <p className="mt-1 line-clamp-2 max-w-md text-center text-sm leading-relaxed text-muted">
                    “{lastTeacherLine}”
                  </p>
                )}
                {audioBlocked && (
                  <button
                    onClick={() =>
                      void audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {})
                    }
                    className="mt-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-warm"
                  >
                    🔊 Tap to hear Sofía
                  </button>
                )}
              </div>

              {/* live widgets + suggestions */}
              <div className="mt-6 flex w-full max-w-md flex-col items-center gap-4 pb-4">
                {stageWidgets.map(
                  (item) =>
                    item.kind === "widget" && (
                      <div key={item.widget.id} className="w-full">
                        {item.widget.type === "word" ? (
                          <WordCardWidget card={item.widget.payload} onResult={onWidgetResult} />
                        ) : item.widget.type === "quiz" ? (
                          <QuizWidget quiz={item.widget.payload} onResult={onWidgetResult} />
                        ) : (
                          <GrammarTableWidget table={item.widget.payload} />
                        )}
                      </div>
                    ),
                )}
                {snap.suggestions.map((s) => (
                  <SuggestionCard key={s.lessonId} suggestion={s} />
                ))}
              </div>

              {textMode && (
                <form onSubmit={submitText} className="mt-auto flex w-full max-w-md shrink-0 gap-2 pb-2">
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
              )}
            </>
          )}
        </div>

        {/* ── collapsible transcript drawer (right) ───────────────────── */}
        <aside
          className={`absolute inset-y-0 right-0 z-20 w-full max-w-sm transform border-l border-line bg-surface shadow-warm transition-transform duration-300 sm:relative sm:inset-auto sm:h-full sm:shrink-0 ${
            showTranscript
              ? "translate-x-0"
              : "translate-x-full sm:hidden sm:translate-x-0"
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Transcript
              </p>
              <button
                onClick={() => setShowTranscript(false)}
                className="rounded-full px-2 py-0.5 text-sm text-muted hover:bg-surface-2"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PracticeFeed
                feed={snap.feed}
                teacherSpeaking={status === "active" && snap.phase === "speaking"}
                onWidgetResult={onWidgetResult}
                widgetStyle="compact"
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: LessonSuggestion }) {
  const badge = suggestion.lessonId.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
  return (
    <div className="bubble-in flex w-full items-center justify-between gap-4 rounded-2xl border border-primary/30 bg-primary-soft p-4 shadow-warm">
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
