import { z } from "zod";
import type { Message } from "@/lib/lesson-machine/machine";
import { localGrade } from "@/lib/lesson-machine/localGrade";
import {
  coachPhrase,
  deliverFirstPhrase,
  deliverNextPhrase,
  naturalComplete,
  teachThenNextPhrase,
} from "@/lib/lesson-machine/chunkPrompts";
import { MEMORY_CATEGORIES } from "@/lib/memory/categories";
import type { LessonPair } from "@/lib/lessons/parse";
import {
  functionCallOutput,
  isFunctionCall,
  itemDelete,
  outputTranscriptDone,
  responseContinue,
  responseCreate,
  type ServerEvent,
} from "./events";
import { addUsage, emptyStats, type SessionStats } from "./harness";

export type ChunkPhase = "connecting" | "speaking" | "listening" | "complete" | "error";

export type ChunkSnapshot = {
  phase: ChunkPhase;
  messages: Message[];
  creditedCount: number;
  totalLines: number;
  micActive: boolean;
  stats: SessionStats;
  error: string | null;
  warning: string | null;
};

export type ChunkHooks = {
  postAttempts: (
    attempts: { lessonId: string; lineIndex: number; userResponse: string; isCorrect: boolean }[],
  ) => Promise<void>;
  postMemory: (entry: { category: string; observation: string }) => Promise<void>;
  onComplete: () => void;
};

type Line = { index: number; teacher: string; student: string };

const UpdateMemoryArgs = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  observation: z.string().min(3).max(300),
});

const SESSION_CAP_MS = 25 * 60_000;
const IDLE_CAP_MS = 3 * 60_000;
const TRANSCRIPT_FALLBACK_MS = 2500;
const MAX_ATTEMPTS = 3;
const BATCH_FLUSH_EVERY = 8;
const PRUNE_AT_ITEMS = 30;
const PRUNE_CHUNK = 12;

/**
 * Natural lesson: the app teaches ONE phrase at a time, in order, driving every
 * response itself (create_response is off). Local grading credits a phrase when
 * the student says it; only then does the app advance. The model receives a
 * single current phrase per turn, so it cannot jump ahead or invent material.
 */
export class ChunkLessonOrchestrator {
  private phase: ChunkPhase = "connecting";
  private messages: Message[] = [];
  private micActive = false;
  private stats = emptyStats();
  private error: string | null = null;
  private warning: string | null = null;

  private lessonId: string;
  private lessonTitle: string;
  private credited: Set<number>;
  private remaining: Line[];
  private attempts = 0;
  private lastStudent = "";
  private pendingBatch: {
    lessonId: string;
    lineIndex: number;
    userResponse: string;
    isCorrect: boolean;
  }[] = [];

  private send: (event: object) => void;
  private hooks: ChunkHooks;

  private started = false;
  private inResponse = false;
  private gradingInFlight = false;
  private awaitingTranscript = false;
  private lessonDone = false;
  private itemIds: string[] = [];
  private transcriptTimer: ReturnType<typeof setTimeout> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private capReached = false;

  private listeners = new Set<() => void>();
  private snapshotCache: ChunkSnapshot | null = null;

  constructor(opts: {
    lessonId: string;
    lessonTitle: string;
    pairs: LessonPair[];
    initialCredits: number[];
    send: (event: object) => void;
    hooks: ChunkHooks;
  }) {
    this.lessonId = opts.lessonId;
    this.lessonTitle = opts.lessonTitle;
    this.credited = new Set(opts.initialCredits);
    this.remaining = opts.pairs
      .map((p, index) => ({ index, teacher: p.teacher, student: p.student }))
      .filter((l) => !this.credited.has(l.index));
    this.send = opts.send;
    this.hooks = opts.hooks;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): ChunkSnapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        phase: this.phase,
        messages: this.messages,
        creditedCount: this.credited.size,
        totalLines: this.credited.size + this.remaining.length,
        micActive: this.micActive,
        stats: this.stats,
        error: this.error,
        warning: this.warning,
      };
    }
    return this.snapshotCache;
  };

  private current(): Line | null {
    return this.remaining[0] ?? null;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.capTimer = setTimeout(() => this.reachCap(), SESSION_CAP_MS);
    this.armIdleTimer();

    const cur = this.current();
    if (!cur) {
      this.finishLesson();
      return;
    }
    this.send(responseCreate({ kind: "deliver", instructions: deliverFirstPhrase(cur) }));
  }

  submitText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.phase === "complete" || this.phase === "error") return;
    if (this.gradingInFlight || this.inResponse || !this.current()) return;
    this.pushMessage({ role: "student", text: trimmed });
    this.lastStudent = trimmed;
    this.gradeCurrent(trimmed);
  }

  stop(): void {
    this.flushBatch();
    if (this.transcriptTimer) clearTimeout(this.transcriptTimer);
    if (this.capTimer) clearTimeout(this.capTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.listeners.clear();
  }

  handleServerEvent(ev: ServerEvent): void {
    this.armIdleTimer();

    switch (ev.type) {
      case "session.created":
        this.start();
        return;

      case "input_audio_buffer.speech_started":
        this.micActive = true;
        this.emit();
        return;

      case "input_audio_buffer.speech_stopped":
        this.micActive = false;
        this.emit();
        return;

      case "input_audio_buffer.committed":
        if (
          this.started &&
          !this.inResponse &&
          !this.gradingInFlight &&
          !this.lessonDone &&
          this.current()
        ) {
          this.gradingInFlight = true;
          this.awaitingTranscript = true;
          this.transcriptTimer = setTimeout(() => {
            if (this.awaitingTranscript) this.gradeCurrent("");
          }, TRANSCRIPT_FALLBACK_MS);
        }
        return;

      case "conversation.item.created": {
        const id = ev.item?.id;
        if (typeof id === "string" && !this.itemIds.includes(id)) {
          this.itemIds.push(id);
          if (this.itemIds.length > PRUNE_AT_ITEMS) {
            const drop = this.itemIds.splice(0, PRUNE_CHUNK);
            for (const dropId of drop) this.send(itemDelete(dropId));
          }
        }
        return;
      }

      case "response.created":
        this.inResponse = true;
        return;

      case "response.done":
        this.handleResponseDone(ev);
        return;

      case "error": {
        const message: string = ev.error?.message ?? "Realtime session error";
        this.inResponse = false;
        if (this.gradingInFlight) {
          this.gradingInFlight = false;
          this.awaitingTranscript = false;
          if (this.transcriptTimer) clearTimeout(this.transcriptTimer);
        }
        if (ev.error?.type === "invalid_request_error" && this.phase !== "connecting") {
          this.warning = message;
        } else {
          this.error = message;
          this.phase = "error";
        }
        this.emit();
        return;
      }
    }

    if (ev.type === "conversation.item.input_audio_transcription.completed") {
      const text = String(ev.transcript ?? "").trim();
      if (text) {
        this.pushMessage({ role: "student", text });
        this.lastStudent = text;
      }
      if (this.awaitingTranscript) this.gradeCurrent(text);
      return;
    }

    const outDone = outputTranscriptDone(ev);
    if (outDone) {
      const text = outDone.transcript.trim();
      if (text) {
        this.pushMessage({ role: "teacher", text });
        this.emit();
      }
      return;
    }

    if (
      (ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta") &&
      this.phase !== "complete" &&
      this.phase !== "error" &&
      this.phase !== "speaking"
    ) {
      this.phase = "speaking";
      this.emit();
    }
  }

  private handleResponseDone(ev: ServerEvent): void {
    addUsage(this.stats, ev.response?.usage);
    this.inResponse = false;
    const kind: string | undefined = ev.response?.metadata?.kind;
    const output: unknown[] = Array.isArray(ev.response?.output) ? ev.response.output : [];

    for (const item of output) {
      if (!isFunctionCall(item)) continue;
      if (item.name === "update_learner_memory") {
        try {
          const args = UpdateMemoryArgs.parse(JSON.parse(item.arguments));
          void this.hooks.postMemory(args).catch(() => {});
          this.send(functionCallOutput(item.call_id, { ok: true }));
        } catch {
          this.send(functionCallOutput(item.call_id, { ok: false, error: "invalid arguments" }));
        }
      }
    }

    if (kind === "complete") {
      this.phase = "complete";
      this.emit();
      this.hooks.onComplete();
      return;
    }

    // a memory tool call inside a teaching turn needs a continuation to speak
    if (output.some((i) => isFunctionCall(i)) && (kind === "deliver" || kind === "coach")) {
      this.send(responseContinue());
      return;
    }

    if (kind === "deliver" || kind === "coach" || kind === "teach") {
      if (this.phase !== "complete" && this.phase !== "error") {
        this.phase = "listening";
        this.emit();
      }
      // the teach-then-advance turn already introduced the next phrase; if that
      // was the last one, close out the lesson now
      if (kind === "teach" && this.remaining.length === 0) this.finishLesson();
    }
  }

  private gradeCurrent(transcript: string): void {
    this.gradingInFlight = false;
    this.awaitingTranscript = false;
    if (this.transcriptTimer) clearTimeout(this.transcriptTimer);

    const cur = this.current();
    if (!cur) return;
    const said = transcript.trim() || this.lastStudent || "(unclear)";
    const verdict = transcript.trim() ? localGrade(cur.student, transcript) : "unsure";

    if (verdict === "pass") {
      this.creditAndShift(said, true);
      const next = this.current();
      if (next) {
        this.send(responseCreate({ kind: "deliver", instructions: deliverNextPhrase(next) }));
      } else {
        this.finishLesson();
      }
      this.emit();
      return;
    }

    this.attempts += 1;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.creditAndShift(said, false); // attempted; struggle captured, move on
      const next = this.current();
      this.attempts = 0;
      this.send(
        responseCreate({
          kind: "teach",
          instructions: teachThenNextPhrase({ student: cur.student, next }),
        }),
      );
      if (!next && cur) {
        void this.hooks
          .postMemory({
            category: "vocab",
            observation: `Struggles with «${cur.student}» — needed extra teaching`,
          })
          .catch(() => {});
      }
      this.emit();
      return;
    }

    this.send(
      responseCreate({
        kind: "coach",
        instructions: coachPhrase({ student: cur.student, said, attempt: this.attempts }),
      }),
    );
    this.emit();
  }

  private creditAndShift(userResponse: string, isCorrect: boolean): void {
    const cur = this.remaining.shift();
    if (!cur) return;
    this.credited.add(cur.index);
    this.attempts = 0;
    this.pendingBatch.push({
      lessonId: this.lessonId,
      lineIndex: cur.index,
      userResponse,
      isCorrect,
    });
    if (this.pendingBatch.length >= BATCH_FLUSH_EVERY) this.flushBatch();
  }

  private finishLesson(): void {
    if (this.lessonDone) return;
    if (this.inResponse) return; // retried from the current response's done
    this.lessonDone = true;
    this.flushBatch();
    this.send(responseCreate({ kind: "complete", instructions: naturalComplete(this.lessonTitle) }));
    this.emit();
  }

  private flushBatch(): void {
    if (this.pendingBatch.length === 0) return;
    const batch = this.pendingBatch;
    this.pendingBatch = [];
    void this.hooks.postAttempts(batch).catch(() => {
      this.warning = "Progress could not be saved — check your connection.";
      this.emit();
    });
  }

  private reachCap(): void {
    if (this.capReached || this.phase === "complete" || this.phase === "error") return;
    this.capReached = true;
    if (!this.inResponse) this.finishLesson();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.phase === "complete" || this.phase === "error") return;
    this.idleTimer = setTimeout(() => this.reachCap(), IDLE_CAP_MS);
  }

  private pushMessage(m: Message): void {
    this.messages = [...this.messages, m];
    this.emit();
  }

  private emit(): void {
    this.snapshotCache = null;
    for (const cb of this.listeners) cb();
  }
}
