"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TranscriptView } from "@/components/TranscriptView";
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
  teacher_speaking: "Profesora Sofía is speaking",
  listening: "Your turn — speak!",
  grading: "Listening… one moment",
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

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <audio ref={audioRef} hidden />

      {/* top bar */}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div>
          <Link href="/lessons" className="text-xs text-zinc-400 hover:underline">
            ← All lessons
          </Link>
          <h1 className="font-semibold">{props.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            Line {Math.min(machine.currentIndex + 1, machine.pairs.length)}/{machine.pairs.length}
          </span>
          {status === "active" && (
            <>
              {!textMode && (
                <button
                  onClick={toggleMute}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    micMuted
                      ? "border-red-300 text-red-600 dark:border-red-700 dark:text-red-400"
                      : "border-black/10 dark:border-white/15"
                  }`}
                >
                  {micMuted ? "Unmute" : "Mute"}
                </button>
              )}
              <button
                onClick={endSession}
                className="rounded-full border border-black/10 px-3 py-1 text-xs hover:bg-zinc-50 dark:border-white/15 dark:hover:bg-zinc-800"
              >
                End session
              </button>
            </>
          )}
        </div>
      </div>

      {/* progress bar */}
      <div className="h-1 w-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-indigo-500 transition-all"
          style={{
            width: `${machine.pairs.length ? Math.round((machine.currentIndex / machine.pairs.length) * 100) : 0}%`,
          }}
        />
      </div>

      {props.dbWarning && (
        <p className="bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          Database unreachable — this session won&apos;t save progress.
        </p>
      )}
      {snap.warning && (
        <p className="bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          {snap.warning}
        </p>
      )}

      {/* transcript */}
      <div className="flex-1 overflow-y-auto">
        <TranscriptView
          messages={machine.messages}
          teacherSpeaking={status === "active" && snap.phase === "teacher_speaking"}
        />
      </div>

      {/* bottom panel */}
      <div className="border-t border-black/10 p-4 dark:border-white/10">
        {complete ? (
          <CompletionPanel {...props} firstTrySummary={snap} />
        ) : status === "idle" || status === "starting" ? (
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={start}
              disabled={status === "starting"}
              className="rounded-full bg-indigo-600 px-10 py-3.5 text-lg font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {status === "starting"
                ? "Connecting…"
                : props.resumeIndex > 0
                  ? `Resume at line ${props.resumeIndex + 1}`
                  : "Start lesson"}
            </button>
            <p className="text-xs text-zinc-400">
              Uses your microphone — the teacher listens and replies in realtime.
            </p>
          </div>
        ) : status === "error" || snap.phase === "error" ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              {startError ?? snap.error ?? "Something went wrong."}
            </p>
            {needsKey ? (
              <Link
                href="/settings"
                className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Add your OpenAI key in Settings
              </Link>
            ) : (
              <button
                onClick={() => window.location.reload()}
                className="rounded-full bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Reconnect & resume
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <StatusPill phase={snap.phase} micActive={snap.micActive} />
            {textMode && machine.expectingStudent && (
              <form onSubmit={submitText} className="flex w-full max-w-lg gap-2">
                <input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type your answer in Spanish…"
                  className="flex-1 rounded-lg border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 dark:border-white/15 dark:bg-zinc-800"
                />
                <button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
                  Send
                </button>
              </form>
            )}
            {textMode && (
              <p className="text-xs text-zinc-400">
                Microphone unavailable — you can type your answers instead.
              </p>
            )}
          </div>
        )}
      </div>

      {showDebug && <DebugOverlay snap={snap} />}
    </div>
  );
}

function StatusPill({ phase, micActive }: { phase: Snapshot["phase"]; micActive: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          micActive
            ? "animate-pulse bg-red-500"
            : phase === "teacher_speaking"
              ? "animate-pulse bg-indigo-500"
              : phase === "grading"
                ? "bg-amber-500"
                : "bg-emerald-500"
        }`}
      />
      {PHASE_LABEL[phase]}
    </div>
  );
}

function CompletionPanel(props: Props & { firstTrySummary: Snapshot }) {
  const { stats } = props.firstTrySummary;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-2xl">🎉</p>
      <p className="font-medium">Lesson complete — ¡muy bien!</p>
      {stats.usdCost > 0 && (
        <p className="text-xs text-zinc-400">
          Session cost ≈ ${stats.usdCost.toFixed(2)} · your progress is saved
        </p>
      )}
      <div className="flex gap-3">
        <Link
          href="/lessons"
          className="rounded-full border border-black/10 px-5 py-2 text-sm hover:bg-zinc-50 dark:border-white/15 dark:hover:bg-zinc-800"
        >
          All lessons
        </Link>
        {props.nextLessonId && (
          <Link
            href={`/lessons/${props.nextLessonId}`}
            className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
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
    <div className="fixed bottom-24 right-4 z-50 w-64 rounded-xl border border-black/10 bg-white/95 p-3 font-mono text-[11px] shadow-lg dark:border-white/10 dark:bg-zinc-900/95">
      <p className="mb-1 font-semibold">harness</p>
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
