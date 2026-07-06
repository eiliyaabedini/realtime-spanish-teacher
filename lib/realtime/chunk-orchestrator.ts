import { z } from "zod";
import type { Message } from "@/lib/lesson-machine/machine";
import { creditsForUtterance, planChunk, type ChunkPlan } from "@/lib/lesson-machine/chunk";
import {
  chunkCompleteInstructions,
  chunkOpening,
  chunkPersona,
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
  sessionUpdateInstructions,
  textUserMessage,
  type ServerEvent,
} from "./events";
import { addUsage, emptyStats, type SessionStats } from "./harness";

export type ChunkPhase = "connecting" | "speaking" | "listening" | "complete" | "error";

export type ChunkSnapshot = {
  phase: ChunkPhase;
  messages: Message[];
  creditedCount: number;
  totalLines: number;
  chunkNumber: number;
  totalChunks: number;
  chunkRemaining: number;
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

const UpdateMemoryArgs = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  observation: z.string().min(3).max(300),
});

const SESSION_CAP_MS = 25 * 60_000;
const IDLE_CAP_MS = 3 * 60_000;
/** context pruning keeps per-turn input flat on long lessons */
const PRUNE_AT_ITEMS = 30;
const PRUNE_CHUNK = 12;

export class ChunkLessonOrchestrator {
  private phase: ChunkPhase = "connecting";
  private messages: Message[] = [];
  private micActive = false;
  private stats = emptyStats();
  private error: string | null = null;
  private warning: string | null = null;

  private lessonId: string;
  private lessonTitle: string;
  private pairs: LessonPair[];
  private chunkSize: number;
  private profileBlock: string;
  private credited: Set<number>;
  private plan: ChunkPlan;
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
  private advancePending = false;
  private lastAdvanceSentAt = 0;
  private lessonDone = false;
  private itemIds: string[] = [];
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
    chunkSize: number;
    profileBlock: string;
    send: (event: object) => void;
    hooks: ChunkHooks;
  }) {
    this.lessonId = opts.lessonId;
    this.lessonTitle = opts.lessonTitle;
    this.pairs = opts.pairs;
    this.chunkSize = opts.chunkSize;
    this.profileBlock = opts.profileBlock;
    this.credited = new Set(opts.initialCredits);
    this.plan = planChunk(this.pairs, this.credited, this.chunkSize);
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
        totalLines: this.pairs.length,
        chunkNumber: this.plan.chunkNumber,
        totalChunks: this.plan.totalChunks,
        chunkRemaining: this.plan.lines.filter((l) => !this.credited.has(l.index)).length,
        micActive: this.micActive,
        stats: this.stats,
        error: this.error,
        warning: this.warning,
      };
    }
    return this.snapshotCache;
  };

  /** The persona for the CURRENT chunk — the secret route uses this for minting. */
  currentPersona(): string {
    return chunkPersona({
      lessonTitle: this.lessonTitle,
      profileBlock: this.profileBlock,
      lines: this.plan.lines,
      chunkNumber: this.plan.chunkNumber,
      totalChunks: this.plan.totalChunks,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.capTimer = setTimeout(() => this.reachCap(), SESSION_CAP_MS);
    this.armIdleTimer();

    if (this.plan.lines.length === 0) {
      this.finishLesson();
      return;
    }
    this.send(
      responseCreate({ kind: "open", instructions: chunkOpening(this.credited.size === 0) }),
    );
  }

  submitText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.phase === "complete" || this.phase === "error") return;
    this.messages = [...this.messages, { role: "student", text: trimmed }];
    this.creditUtterance(trimmed);
    this.emit();
    this.send(textUserMessage(trimmed));
    if (!this.inResponse) this.send(responseContinue());
  }

  stop(): void {
    this.flushBatch();
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
        if (this.phase === "speaking") this.phase = "listening";
        this.emit();
        return;

      case "input_audio_buffer.speech_stopped":
        this.micActive = false;
        this.emit();
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
        void this.handleResponseDone(ev);
        return;

      case "error": {
        const message: string = ev.error?.message ?? "Realtime session error";
        // a chunk advance that raced a VAD auto-response — retry on its done
        if (
          /active response/i.test(message) &&
          !this.lessonDone &&
          Date.now() - this.lastAdvanceSentAt < 5000
        ) {
          this.advancePending = true;
          return;
        }
        this.inResponse = false;
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
        this.messages = [...this.messages, { role: "student", text }];
        this.creditUtterance(text);
        this.emit();
      }
      return;
    }

    const outDone = outputTranscriptDone(ev);
    if (outDone) {
      const text = outDone.transcript.trim();
      if (text) {
        this.messages = [...this.messages, { role: "teacher", text }];
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

  private async handleResponseDone(ev: ServerEvent): Promise<void> {
    addUsage(this.stats, ev.response?.usage);
    this.inResponse = false;
    const kind: string | undefined = ev.response?.metadata?.kind;
    const output: unknown[] = Array.isArray(ev.response?.output) ? ev.response.output : [];

    if (kind === "complete") {
      this.phase = "complete";
      this.emit();
      this.hooks.onComplete();
      return;
    }

    let finishRequested = false;
    for (const item of output) {
      if (!isFunctionCall(item)) continue;
      if (item.name === "finish_chunk") {
        finishRequested = true;
        this.send(functionCallOutput(item.call_id, { ok: true }));
      } else if (item.name === "update_learner_memory") {
        try {
          const args = UpdateMemoryArgs.parse(JSON.parse(item.arguments));
          void this.hooks.postMemory(args).catch(() => {});
          this.send(functionCallOutput(item.call_id, { ok: true }));
        } catch {
          this.send(functionCallOutput(item.call_id, { ok: false, error: "invalid arguments" }));
        }
      }
    }

    if (finishRequested) this.advancePending = true;
    if (this.advancePending) {
      this.advanceChunk();
      return;
    }

    if (output.some((i) => isFunctionCall(i))) {
      this.send(responseContinue());
      return;
    }

    if (this.phase !== "complete" && this.phase !== "error") {
      this.phase = "listening";
      this.emit();
    }
  }

  private creditUtterance(transcript: string): void {
    const remaining = this.plan.lines.filter((l) => !this.credited.has(l.index));
    const hits = creditsForUtterance(transcript, remaining);
    for (const index of hits) {
      this.credited.add(index);
      this.pendingBatch.push({
        lessonId: this.lessonId,
        lineIndex: index,
        userResponse: transcript,
        isCorrect: true,
      });
    }
    if (hits.length === 0) return;

    // whole chunk covered → advance (deferred whenever a response is active)
    const left = this.plan.lines.some((l) => !this.credited.has(l.index));
    if (!left) {
      this.advancePending = true;
      if (!this.inResponse) this.advanceChunk();
    }
  }

  private advanceChunk(): void {
    if (this.inResponse) {
      this.advancePending = true;
      return;
    }
    this.advancePending = false;
    this.flushBatch();
    this.plan = planChunk(this.pairs, this.credited, this.chunkSize);
    if (this.plan.lines.length === 0) {
      this.finishLesson();
      return;
    }
    this.lastAdvanceSentAt = Date.now();
    this.send(sessionUpdateInstructions(this.currentPersona()));
    this.send(responseCreate({ kind: "open", instructions: chunkOpening(false) }));
    this.emit();
  }

  private finishLesson(): void {
    if (this.lessonDone) return;
    if (this.inResponse) {
      this.advancePending = true;
      return;
    }
    this.lessonDone = true;
    this.flushBatch();
    this.lastAdvanceSentAt = Date.now();
    this.send(
      responseCreate({ kind: "complete", instructions: chunkCompleteInstructions(this.lessonTitle) }),
    );
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
    this.finishLesson();
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.phase === "complete" || this.phase === "error") return;
    this.idleTimer = setTimeout(() => this.reachCap(), IDLE_CAP_MS);
  }

  private emit(): void {
    this.snapshotCache = null;
    for (const cb of this.listeners) cb();
  }
}
