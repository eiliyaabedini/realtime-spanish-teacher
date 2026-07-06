"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TranscriptView } from "@/components/TranscriptView";
import { VoiceOrb, phaseToOrb } from "@/components/VoiceOrb";
import type { HistoryEntry } from "@/lib/lesson-machine/machine";
import { initMachine } from "@/lib/lesson-machine/machine";
import type { LessonPair } from "@/lib/lessons/parse";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime/connection";
import { meanDrift, p50 } from "@/lib/realtime/harness";
import { LessonOrchestrator, type Snapshot } from "@/lib/realtime/orchestrator";

type Props = {
  lessonId: string;
  title: string;
  pairs: LessonPair[];
  resumeIndex: number;
  history: HistoryEntry[];
  isFirstSession: boolean;
  nextLessonId: string | null;
  dbWarning: boolean;
};

type Status = "idle" | "starting" | "active" | "error";

const emptySubscribe = () => () => {};

const PHASE_LABEL: Record<Snapshot["phase"], string> = {
  connecting: "Connecting…",
  teacher_speaking: "Sofía is speaking…",
  listening: "Your turn — ¡habla!",
  grading: "Listening closely…",
  complete: "Lesson complete",
  error: "Connection problem",
};

export function LessonSession(props: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState("");

  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);
  const orchRef = useRef<LessonOrchestrator | null>(null);

  const showDebug = useSyncExternalStore(
    emptySubscribe,
    () => new URLSearchParams(window.location.search).has("debug"),
    () => false,
  );

  useEffect(() => {
    return () => {
      orchRef.current?.stop();
      connRef.current?.close();
    };
  }, []);

  const subscribe = useCallback((cb: () => void) => {
    return orchRef.current ? orchRef.current.subscribe(cb) : () => {};
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps -- re-subscribe once the orchestrator exists

  const idleSnapshot = useRef<Snapshot | null>(null);
  const getSnapshot = useCallback((): Snapshot => {
    if (orchRef.current) return orchRef.current.getSnapshot();
    if (!idleSnapshot.current) {
      idleSnapshot.current = {
        phase: "connecting",
        machine: initMachine(props.lessonId, props.pairs, props.resumeIndex, props.history),
        micActive: false,
        stats: { turnLatenciesMs: [], driftScores: [], usdCost: 0, inputTokens: 0, outputTokens: 0 },
        error: null,
        warning: null,
      };
    }
    return idleSnapshot.current;
  }, [props.lessonId, props.pairs, props.resumeIndex, props.history]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  async function start() {
    setStatus("starting");
    setStartError(null);
    setNeedsKey(false);

    try {
      const res = await fetch("/api/realtime/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: props.lessonId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "no_api_key") setNeedsKey(true);
        throw new Error(data?.message ?? "Could not start the session.");
      }

      const machine = initMachine(props.lessonId, props.pairs, props.resumeIndex, props.history);
      const orchestrator = new LessonOrchestrator({
        machine,
        greeting: props.isFirstSession ? "first" : "returning",
        send: (event) => connRef.current?.send(event),
        hooks: {
          postProgress: async (attempt) => {
            const r = await fetch("/api/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attempt),
            });
            if (!r.ok) throw new Error("progress save failed");
          },
          postMemory: async (entry) => {
            await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry),
            });
          },
          onComplete: () => {
            void fetch("/api/memory/summarize", { method: "POST" }).catch(() => {});
          },
        },
      });
      orchRef.current = orchestrator;

      const connection = await connectRealtime({
        clientSecret: data.clientSecret,
        audioElement: audioRef.current!,
        onEvent: (ev) => orchRef.current?.handleServerEvent(ev),
        onConnectionChange: (state) => {
          if (state === "failed" || state === "disconnected") {
            setStartError("Connection lost. Your progress is saved — resume any time.");
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

  const machine = snap.machine;
  const complete = snap.phase === "complete" || (status === "idle" && machine.isComplete);
  const progressPct = machine.pairs.length
    ? Math.round((machine.currentIndex / machine.pairs.length) * 100)
    : 0;

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
              {props.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
              {Math.min(machine.currentIndex + 1, machine.pairs.length)} / {machine.pairs.length}
            </span>
            {status === "active" && (
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
                  End
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* progress */}
      <div className="h-1 w-full bg-surface-2">
        <div
          className="h-full rounded-r-full transition-all duration-700"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, var(--gold), var(--primary))",
          }}
        />
      </div>

      {props.dbWarning && (
        <p className="bg-gold-soft px-4 py-2 text-center text-xs text-gold">
          Database unreachable — this session won&apos;t save progress.
        </p>
      )}
      {snap.warning && (
        <p className="bg-gold-soft px-4 py-2 text-center text-xs text-gold">{snap.warning}</p>
      )}

      {/* transcript */}
      <div className="flex-1 overflow-y-auto">
        <TranscriptView
          messages={machine.messages}
          teacherSpeaking={status === "active" && snap.phase === "teacher_speaking"}
        />
      </div>

      {/* bottom dock */}
      <div className="border-t border-line bg-surface/80 px-5 py-5 backdrop-blur">
        <div className="mx-auto max-w-2xl">
          {complete ? (
            <CompletionPanel {...props} snap={snap} />
          ) : status === "idle" || status === "starting" ? (
            <div className="flex flex-col items-center gap-3">
              <VoiceOrb state="idle" size={72} />
              <button
                onClick={start}
                disabled={status === "starting"}
                className="rounded-full bg-primary px-12 py-4 text-lg font-medium text-white shadow-warm transition hover:-translate-y-0.5 hover:bg-primary-strong disabled:translate-y-0 disabled:opacity-60"
              >
                {status === "starting"
                  ? "Connecting…"
                  : props.resumeIndex > 0
                    ? `Resume at line ${props.resumeIndex + 1}`
                    : "Start lesson"}
              </button>
              <p className="text-xs text-muted">
                Uses your microphone — Sofía listens and replies in realtime.
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
                  Reconnect & resume
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-5">
              <VoiceOrb state={phaseToOrb(snap.phase, snap.micActive)} size={72} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  {snap.micActive && (
                    <span className="mic-live inline-block h-2 w-2 rounded-full bg-error" />
                  )}
                  {snap.micActive ? "I can hear you…" : PHASE_LABEL[snap.phase]}
                </p>
                {textMode && machine.expectingStudent ? (
                  <form onSubmit={submitText} className="mt-2 flex w-72 max-w-full gap-2">
                    <input
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Type your answer in Spanish…"
                      className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
                    />
                    <button className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-strong">
                      Send
                    </button>
                  </form>
                ) : (
                  <p className="mt-0.5 text-xs text-muted">
                    {textMode
                      ? "Microphone unavailable — type your answers instead."
                      : "Speak naturally — you can interrupt her any time."}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showDebug && <DebugOverlay snap={snap} />}
    </div>
  );
}

function CompletionPanel(props: Props & { snap: Snapshot }) {
  const { stats } = props.snap;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="font-display text-4xl font-semibold tracking-tight">
        ¡Muy <span className="italic text-primary">bien!</span> 🎉
      </p>
      <p className="text-sm text-muted">
        Lesson complete — your progress is saved
        {stats.usdCost > 0 && <> · session ≈ ${stats.usdCost.toFixed(2)}</>}
      </p>
      <div className="mt-1 flex gap-3">
        <Link
          href="/lessons"
          className="rounded-full border border-line px-6 py-2.5 text-sm font-medium transition hover:bg-surface-2"
        >
          All lessons
        </Link>
        {props.nextLessonId && (
          <Link
            href={`/lessons/${props.nextLessonId}`}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-warm transition hover:bg-primary-strong"
          >
            Next lesson →
          </Link>
        )}
      </div>
    </div>
  );
}

function DebugOverlay({ snap }: { snap: Snapshot }) {
  const drift = meanDrift(snap.stats);
  const latency = p50(snap.stats.turnLatenciesMs);
  return (
    <div className="fixed bottom-28 right-4 z-50 w-64 rounded-2xl border border-line bg-surface/95 p-3 font-mono text-[11px] shadow-warm backdrop-blur">
      <p className="mb-1 font-semibold text-primary">harness</p>
      <p>phase: {snap.phase}</p>
      <p>cost: ${snap.stats.usdCost.toFixed(4)}</p>
      <p>
        tokens: {snap.stats.inputTokens} in / {snap.stats.outputTokens} out
      </p>
      <p>p50 turn latency: {latency !== null ? `${latency}ms` : "–"}</p>
      <p>mean drift: {drift !== null ? drift.toFixed(3) : "–"}</p>
      <p>drift samples: {snap.stats.driftScores.length}</p>
    </div>
  );
}
