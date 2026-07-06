"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Teacher } from "@/components/Teacher";
import { guideOpening } from "@/lib/guide/prompts";
import { connectRealtime, type RealtimeConnection } from "@/lib/realtime/connection";
import {
  PracticeOrchestrator,
  type PracticeSnapshot,
} from "@/lib/realtime/practice-orchestrator";

export type NextStepView = {
  href: string;
  label: string;
  detail: string;
};

type Props = {
  firstName: string | null;
  lessonIndex: { id: string; title: string }[];
  nextStep: NextStepView;
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

const GUIDE_CAP_MS = 5 * 60_000;
const GUIDE_IDLE_MS = 90_000;

export function JourneyGuide({ firstName, lessonIndex, nextStep }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [startError, setStartError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const connRef = useRef<RealtimeConnection | null>(null);
  const orchRef = useRef<PracticeOrchestrator | null>(null);

  useEffect(() => {
    return () => {
      orchRef.current?.stop();
      connRef.current?.close();
    };
  }, []);

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
        body: JSON.stringify({ mode: "guide" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "no_api_key") setNeedsKey(true);
        throw new Error(data?.message ?? "Could not start.");
      }

      const orchestrator = new PracticeOrchestrator({
        send: (event) => connRef.current?.send(event),
        lessonIndex,
        capMs: GUIDE_CAP_MS,
        idleMs: GUIDE_IDLE_MS,
        opening: guideOpening(Boolean(data.isFirstSession)),
        hooks: {
          postMemory: async (entry) => {
            await fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry),
            });
          },
          fetchLesson: async () => null, // guide has no lesson-content tool
          onComplete: () => {},
          onNavigate: (target) => {
            const href =
              target.kind === "lesson"
                ? `/lessons/${target.lessonId}?autostart=1`
                : "/practice?autostart=1";
            setNavigatingTo(href);
            connRef.current?.close();
            router.push(href);
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
          if ((state === "failed" || state === "disconnected") && !navigatingTo) {
            setStartError("Connection lost — tap to try again.");
            setStatus("error");
          }
        },
      });
      connRef.current = connection;
      setStatus("active");
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Could not start.");
      setStatus("error");
    }
  }

  function unblockAudio() {
    void audioRef.current?.play().then(() => setAudioBlocked(false)).catch(() => {});
  }

  const lastTeacherLine = [...snap.messages].reverse().find((m) => m.role === "teacher")?.text;
  const teacherState = navigatingTo
    ? "happy"
    : snap.micActive
      ? "listening"
      : snap.phase === "speaking"
        ? "speaking"
        : status === "active"
          ? "listening"
          : "idle";

  return (
    <div className="flex flex-col items-center text-center">
      <audio ref={audioRef} hidden />
      <Teacher state={teacherState} audioRef={audioRef} size={168} />

      {status === "idle" || status === "starting" ? (
        <>
          <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
            ¡Hola{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="mt-3 max-w-md text-pretty text-muted">
            I&apos;m Sofía, your teacher. Tap below — I&apos;ll say hello, tell you what today
            looks like, and take you there.
          </p>
          <button
            onClick={start}
            disabled={status === "starting"}
            className="mt-7 rounded-full bg-primary px-12 py-4 text-lg font-medium text-white shadow-warm transition hover:-translate-y-0.5 hover:bg-primary-strong disabled:translate-y-0 disabled:opacity-60"
          >
            {status === "starting" ? "Connecting…" : "🎙️ Talk to Sofía"}
          </button>
          <Link
            href={nextStep.href}
            className="mt-4 rounded-full border border-line bg-surface px-6 py-2.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            or jump straight in: {nextStep.label} →
          </Link>
          <p className="mt-6 text-xs text-muted">{nextStep.detail}</p>
        </>
      ) : status === "error" ? (
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-sm text-error">{startError}</p>
          {needsKey ? (
            <Link
              href="/settings"
              className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-white transition hover:bg-primary-strong"
            >
              Add your OpenAI key in Settings
            </Link>
          ) : (
            <button
              onClick={start}
              className="rounded-full bg-primary px-7 py-2.5 text-sm font-medium text-white transition hover:bg-primary-strong"
            >
              Try again
            </button>
          )}
          <Link href={nextStep.href} className="text-sm text-muted hover:underline">
            or jump straight in: {nextStep.label} →
          </Link>
        </div>
      ) : (
        <div className="mt-4 flex w-full max-w-lg flex-col items-center gap-3">
          {navigatingTo ? (
            <p className="font-medium text-primary">Vamos — taking you there…</p>
          ) : (
            <>
              <p className="flex items-center gap-2 text-sm font-medium text-muted">
                {snap.micActive && (
                  <span className="mic-live inline-block h-2 w-2 rounded-full bg-error" />
                )}
                {snap.micActive
                  ? "I can hear you…"
                  : snap.phase === "speaking"
                    ? "Sofía is speaking…"
                    : "Your turn — just answer her"}
              </p>
              {lastTeacherLine && (
                <p className="bubble-in line-clamp-3 max-w-md text-pretty text-lg leading-relaxed">
                  “{lastTeacherLine}”
                </p>
              )}
              {audioBlocked && (
                <button
                  onClick={unblockAudio}
                  className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-white shadow-warm"
                >
                  🔊 Tap to hear Sofía
                </button>
              )}
              <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                <Link href={nextStep.href} className="hover:text-ink hover:underline">
                  Skip the chat: {nextStep.label} →
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
