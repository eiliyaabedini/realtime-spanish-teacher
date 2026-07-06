"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatBubble } from "@/components/ChatBubble";
import { CircleButton } from "@/components/SessionControls";
import { Teacher } from "@/components/Teacher";
import type { LessonPair } from "@/lib/lessons/parse";
import { ChunkLessonOrchestrator, type ChunkSnapshot } from "@/lib/realtime/chunk-orchestrator";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime/connection";

type Props = {
  lessonId: string;
  title: string;
  pairs: LessonPair[];
  initialCredits: number[];
  nextLessonId: string | null;
  autostart?: boolean;
};

type Status = "idle" | "starting" | "active" | "error";

export function NaturalLessonSession(props: Props) {
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
  const orchRef = useRef<ChunkLessonOrchestrator | null>(null);
  const autostarted = useRef(false);
  const sessionStartedAt = useRef<number | null>(null);
  const usageSent = useRef(false);

  const sendUsageBeacon = useCallback(() => {
    const stats = orchRef.current?.getSnapshot().stats;
    if (!stats || usageSent.current || stats.usdCost <= 0) return;
    usageSent.current = true;
    const payload = JSON.stringify({
      mode: "lesson",
      usd: stats.usdCost,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
      seconds: sessionStartedAt.current
        ? Math.round((Date.now() - sessionStartedAt.current) / 1000)
        : 0,
    });
    if (!navigator.sendBeacon?.("/api/usage-log", new Blob([payload], { type: "application/json" }))) {
      void fetch("/api/usage-log", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pagehide", sendUsageBeacon);
    return () => {
      window.removeEventListener("pagehide", sendUsageBeacon);
      sendUsageBeacon();
      orchRef.current?.stop();
      connRef.current?.close();
    };
  }, [sendUsageBeacon]);

  useEffect(() => {
    if (props.autostart && !autostarted.current) {
      autostarted.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autostart]);

  const subscribe = useCallback((cb: () => void) => {
    return orchRef.current ? orchRef.current.subscribe(cb) : () => {};
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps -- re-subscribe once the orchestrator exists

  const emptySnapshot = useRef<ChunkSnapshot | null>(null);
  const getSnapshot = useCallback((): ChunkSnapshot => {
    if (orchRef.current) return orchRef.current.getSnapshot();
    if (!emptySnapshot.current) {
      emptySnapshot.current = {
        phase: "connecting",
        messages: [],
        creditedCount: props.initialCredits.length,
        totalLines: props.pairs.length,
        chunkNumber: 1,
        totalChunks: 1,
        chunkRemaining: 0,
        micActive: false,
        stats: { turnLatenciesMs: [], driftScores: [], usdCost: 0, inputTokens: 0, outputTokens: 0 },
        error: null,
        warning: null,
      };
    }
    return emptySnapshot.current;
  }, [props.initialCredits.length, props.pairs.length]);

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Echo-loop defense: while Sofía speaks, the mic is off — her voice can
  // never commit as "the student", credit phrases, or trigger auto-replies.
  useEffect(() => {
    if (status !== "active") return;
    connRef.current?.setMicEnabled(!micMuted && snap.phase !== "speaking");
  }, [status, micMuted, snap.phase]);

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

      sessionStartedAt.current = Date.now();
      const orchestrator = new ChunkLessonOrchestrator({
        lessonId: props.lessonId,
        lessonTitle: props.title,
        pairs: props.pairs,
        initialCredits: (data.credits as number[] | undefined) ?? props.initialCredits,
        chunkSize: (data.chunkSize as number | undefined) ?? 20,
        profileBlock: (data.profileBlock as string | undefined) ?? "",
        send: (event) => connRef.current?.send(event),
        hooks: {
          postAttempts: async (attempts) => {
            const r = await fetch("/api/progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attempts }),
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
            sendUsageBeacon();
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

  function talkItThrough() {
    const credited = orchRef.current?.getSnapshot().creditedCount ?? props.initialCredits.length;
    orchRef.current?.stop();
    connRef.current?.close();
    connRef.current = null;
    window.location.href = `/practice?from=${props.lessonId}&line=${Math.min(
      credited,
      props.pairs.length - 1,
    )}&autostart=1`;
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
  const pct = snap.totalLines ? Math.round((snap.creditedCount / snap.totalLines) * 100) : 0;
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

      {/* top bar — info only */}
      <div className="border-b border-line bg-surface/80 px-5 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="min-w-0">
            <Link href="/lessons" className="text-xs text-muted transition hover:text-primary">
              ← All lessons
            </Link>
            <h1 className="font-display truncate text-lg font-semibold tracking-tight">
              {props.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {snap.stats.usdCost > 0.005 && (
              <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
                ≈${snap.stats.usdCost.toFixed(2)}
              </span>
            )}
            <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
              {snap.creditedCount}/{snap.totalLines} phrases
            </span>
            {status === "active" && (
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
            )}
          </div>
        </div>
      </div>

      {/* progress */}
      <div className="h-1 w-full bg-surface-2">
        <div
          className="h-full rounded-r-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--gold), var(--primary))",
          }}
        />
      </div>

      {snap.warning && (
        <p className="bg-gold-soft px-4 py-2 text-center text-xs text-gold">{snap.warning}</p>
      )}

      {/* the stage */}
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
                {status === "starting"
                  ? "Connecting…"
                  : props.initialCredits.length > 0
                    ? `Continue (${props.initialCredits.length}/${props.pairs.length} learned)`
                    : "Start lesson"}
              </button>
              <p className="max-w-md text-center text-xs leading-relaxed text-muted">
                Sofía teaches these phrases as one natural conversation — say each one out loud
                and it lights up in your progress.
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
                  Reconnect & resume
                </button>
              )}
            </div>
          ) : complete ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Teacher state="happy" size={170} />
              <p className="font-display text-4xl font-semibold tracking-tight">
                ¡Muy <span className="italic text-primary">bien!</span> 🎉
              </p>
              <p className="text-sm text-muted">
                {snap.creditedCount}/{snap.totalLines} phrases learned · progress saved
                {snap.stats.usdCost > 0 && <> · session ≈ ${snap.stats.usdCost.toFixed(2)}</>}
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
                    href={`/lessons/${props.nextLessonId}?autostart=1`}
                    className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-warm transition hover:bg-primary-strong"
                  >
                    Next lesson →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <>
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
                      : "Your turn — repeat and chat"}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {snap.totalLines - snap.creditedCount} phrases to go
                </p>
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
                <div className="mt-4 flex items-start justify-center gap-5">
                  {!textMode && (
                    <CircleButton
                      icon={micMuted ? "🔇" : "🎙️"}
                      label={micMuted ? "Unmute" : "Mute"}
                      active={micMuted}
                      onClick={toggleMute}
                    />
                  )}
                  <CircleButton icon="💬" label="Discuss" onClick={talkItThrough} />
                  <CircleButton icon="✕" label="End" variant="danger" onClick={endSession} />
                </div>
              </div>

              {textMode && (
                <form onSubmit={submitText} className="mt-6 flex w-full max-w-md shrink-0 gap-2">
                  <input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Type your Spanish…"
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

        {/* transcript drawer */}
        <aside
          className={`absolute inset-y-0 right-0 z-20 w-full max-w-sm transform border-l border-line bg-surface shadow-warm transition-transform duration-300 sm:relative sm:inset-auto sm:h-full sm:shrink-0 ${
            showTranscript ? "translate-x-0" : "translate-x-full sm:hidden sm:translate-x-0"
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
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {snap.messages.map((m, i) => (
                <ChatBubble key={i} message={m} />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
