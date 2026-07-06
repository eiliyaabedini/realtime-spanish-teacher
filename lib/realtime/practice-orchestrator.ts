import { z } from "zod";
import type { Message } from "@/lib/lesson-machine/machine";
import { practiceOpening, practiceWrapUp } from "@/lib/practice/prompts";
import {
  GrammarTablePayload,
  QuizPayload,
  WordCardPayload,
  type WidgetInstance,
} from "@/lib/practice/widgets";
import { MEMORY_CATEGORIES } from "@/lib/memory/categories";
import {
  functionCallOutput,
  isFunctionCall,
  itemDelete,
  outputTranscriptDone,
  responseContinue,
  responseCreate,
  systemMessage,
  textUserMessage,
  type ServerEvent,
} from "./events";
import { addUsage, emptyStats, type SessionStats } from "./harness";

export type PracticePhase = "connecting" | "speaking" | "listening" | "complete" | "error";

export type LessonSuggestion = { lessonId: string; title: string; reason: string };

export type FeedItem =
  | { kind: "message"; message: Message }
  | { kind: "widget"; widget: WidgetInstance };

export type PracticeSnapshot = {
  phase: PracticePhase;
  messages: Message[];
  /** messages and widgets interleaved in arrival order — what the practice UI renders */
  feed: FeedItem[];
  suggestions: LessonSuggestion[];
  micActive: boolean;
  stats: SessionStats;
  error: string | null;
  warning: string | null;
};

export type NavTarget = { kind: "lesson"; lessonId: string } | { kind: "practice" };

export type PracticeHooks = {
  postMemory: (entry: { category: string; observation: string }) => Promise<void>;
  fetchLesson: (
    lessonId: string,
  ) => Promise<{ title: string; pairs: { teacher: string; student: string }[] } | null>;
  onComplete: () => void;
  /** guide mode only: start_lesson / start_practice tool calls land here */
  onNavigate?: (target: NavTarget) => void;
};

const UpdateMemoryArgs = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  observation: z.string().min(3).max(300),
});
const GetLessonArgs = z.object({ lessonId: z.string().min(1) });
const SuggestLessonArgs = z.object({ lessonId: z.string().min(1), reason: z.string().min(3) });
const StartLessonArgs = z.object({ lessonId: z.string().min(1) });

const PRACTICE_CAP_MS = 30 * 60_000;
const IDLE_CAP_MS = 3 * 60_000;
const MAX_SUGGESTIONS = 3;
/** let the send-off audio finish before leaving the page */
const NAV_DELAY_MS = 900;
/** chunked context pruning: long sessions would otherwise re-bill ever-growing audio input */
const PRUNE_AT_ITEMS = 40;
const PRUNE_CHUNK = 16;

export class PracticeOrchestrator {
  private phase: PracticePhase = "connecting";
  private messages: Message[] = [];
  private feed: FeedItem[] = [];
  private suggestions: LessonSuggestion[] = [];
  private widgetCounter = 0;
  private pendingInjections: string[] = [];
  private micActive = false;
  private stats = emptyStats();
  private error: string | null = null;
  private warning: string | null = null;

  private send: (event: object) => void;
  private hooks: PracticeHooks;
  private lessonIndex: Map<string, string>; // id → title

  private started = false;
  private inResponse = false;
  private sawFirstAudio = false;
  private itemIds: string[] = [];
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private capReached = false;
  private capPending = false;
  private capSpoken = false;
  private pendingNav: NavTarget | null = null;
  private navTimer: ReturnType<typeof setTimeout> | null = null;
  private capMs: number;
  private idleMs: number;
  private opening: string | null;

  private listeners = new Set<() => void>();
  private snapshotCache: PracticeSnapshot | null = null;

  constructor(opts: {
    send: (event: object) => void;
    hooks: PracticeHooks;
    lessonIndex: { id: string; title: string }[];
    capMs?: number;
    idleMs?: number;
    /** override the session-opening instruction (guide mode) */
    opening?: string;
  }) {
    this.send = opts.send;
    this.hooks = opts.hooks;
    this.lessonIndex = new Map(opts.lessonIndex.map((l) => [l.id, l.title]));
    this.capMs = opts.capMs ?? PRACTICE_CAP_MS;
    this.idleMs = opts.idleMs ?? IDLE_CAP_MS;
    this.opening = opts.opening ?? null;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): PracticeSnapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        phase: this.phase,
        messages: this.messages,
        feed: this.feed,
        suggestions: this.suggestions,
        micActive: this.micActive,
        stats: this.stats,
        error: this.error,
        warning: this.warning,
      };
    }
    return this.snapshotCache;
  };

  private pushMessage(message: Message): void {
    this.messages = [...this.messages, message];
    this.feed = [...this.feed, { kind: "message", message }];
  }

  private pushWidget(widget: WidgetInstance): void {
    this.feed = [...this.feed, { kind: "widget", widget }];
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.capTimer = setTimeout(() => this.reachCap(), this.capMs);
    this.armIdleTimer();
    this.send(responseCreate({ kind: "open", instructions: this.opening ?? practiceOpening() }));
  }

  submitText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.phase === "complete" || this.phase === "error") return;
    this.pushMessage({ role: "student", text: trimmed });
    this.emit();
    this.send(textUserMessage(trimmed));
    if (!this.inResponse) this.send(responseContinue());
  }

  /**
   * A widget interaction happened (quiz finished, card marked hard…).
   * Injected as a system item so Sofía reacts by voice — gated so it never
   * collides with an active response (flushed on the next response.done).
   */
  sendWidgetResult(summary: string): void {
    if (this.phase === "complete" || this.phase === "error") return;
    this.pendingInjections.push(summary);
    if (!this.inResponse) this.flushInjections();
  }

  private flushInjections(): void {
    if (this.pendingInjections.length === 0) return;
    const text = this.pendingInjections.map((s) => `[widget result] ${s}`).join("\n");
    this.pendingInjections = [];
    this.send(systemMessage(text));
    this.send(responseContinue());
  }

  stop(): void {
    if (this.capTimer) clearTimeout(this.capTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.navTimer) clearTimeout(this.navTimer);
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
          // prune in chunks: one cache miss per prune instead of every turn
          if (this.itemIds.length > PRUNE_AT_ITEMS) {
            const drop = this.itemIds.splice(0, PRUNE_CHUNK);
            for (const dropId of drop) this.send(itemDelete(dropId));
          }
        }
        return;
      }

      case "response.created":
        this.inResponse = true;
        this.sawFirstAudio = false;
        return;

      case "response.done":
        void this.handleResponseDone(ev);
        return;

      case "error": {
        const message: string = ev.error?.message ?? "Realtime session error";
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
        this.pushMessage({ role: "student", text });
        this.emit();
      }
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
      !this.sawFirstAudio
    ) {
      this.sawFirstAudio = true;
      if (this.phase !== "complete" && this.phase !== "error") {
        this.phase = "speaking";
        this.emit();
      }
    }
  }

  private async handleResponseDone(ev: ServerEvent): Promise<void> {
    addUsage(this.stats, ev.response?.usage);
    this.inResponse = false;
    const kind: string | undefined = ev.response?.metadata?.kind;
    const output: unknown[] = Array.isArray(ev.response?.output) ? ev.response.output : [];

    if (kind === "cap") {
      this.phase = "complete";
      this.emit();
      this.hooks.onComplete();
      return;
    }

    let hadToolCall = false;
    for (const item of output) {
      if (!isFunctionCall(item)) continue;
      hadToolCall = true;
      await this.handleToolCall(item.name, item.call_id, item.arguments);
    }

    // navigation tool called — leave once the send-off audio has played out
    if (this.pendingNav) {
      const target = this.pendingNav;
      this.pendingNav = null;
      this.navTimer = setTimeout(() => this.hooks.onNavigate?.(target), NAV_DELAY_MS);
      return;
    }

    if (this.capPending) {
      this.speakWrapUp();
      return;
    }

    if (hadToolCall) {
      this.send(responseContinue());
      return;
    }

    // widget results that arrived while she was talking
    if (this.pendingInjections.length > 0) {
      this.flushInjections();
      return;
    }

    if (this.phase !== "complete" && this.phase !== "error") {
      this.phase = "listening";
      this.emit();
    }
  }

  private async handleToolCall(name: string, callId: string, rawArgs: string): Promise<void> {
    let args: unknown;
    try {
      args = JSON.parse(rawArgs);
    } catch {
      this.send(functionCallOutput(callId, { error: "invalid JSON arguments" }));
      return;
    }

    if (name === "update_learner_memory") {
      const parsed = UpdateMemoryArgs.safeParse(args);
      if (!parsed.success) {
        this.send(functionCallOutput(callId, { error: "invalid arguments" }));
        return;
      }
      void this.hooks.postMemory(parsed.data).catch(() => {});
      this.send(functionCallOutput(callId, { ok: true }));
      return;
    }

    if (name === "get_lesson_content") {
      const parsed = GetLessonArgs.safeParse(args);
      const lesson = parsed.success ? await this.hooks.fetchLesson(parsed.data.lessonId) : null;
      if (!lesson) {
        this.send(functionCallOutput(callId, { error: "unknown lessonId" }));
        return;
      }
      const lines = lesson.pairs
        .map((p) => `Teacher: ${p.teacher}\nStudent: ${p.student}`)
        .join("\n");
      this.send(functionCallOutput(callId, { title: lesson.title, lines }));
      return;
    }

    if (name === "suggest_lesson") {
      const parsed = SuggestLessonArgs.safeParse(args);
      const title = parsed.success ? this.lessonIndex.get(parsed.data.lessonId) : undefined;
      if (!parsed.success || !title) {
        this.send(functionCallOutput(callId, { error: "unknown lessonId — use an id from the curriculum status" }));
        return;
      }
      if (
        this.suggestions.length < MAX_SUGGESTIONS &&
        !this.suggestions.some((s) => s.lessonId === parsed.data.lessonId)
      ) {
        this.suggestions = [
          ...this.suggestions,
          { lessonId: parsed.data.lessonId, title, reason: parsed.data.reason },
        ];
        this.emit();
      }
      this.send(functionCallOutput(callId, { ok: true, shown_to_student: true }));
      return;
    }

    if (name === "show_word_card" || name === "show_quiz" || name === "show_grammar_table") {
      const schema =
        name === "show_word_card"
          ? WordCardPayload
          : name === "show_quiz"
            ? QuizPayload
            : GrammarTablePayload;
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        this.send(
          functionCallOutput(callId, {
            error: `invalid payload: ${parsed.error.issues[0]?.message ?? "schema mismatch"} — fix and call again`,
          }),
        );
        return;
      }
      const type = name === "show_word_card" ? "word" : name === "show_quiz" ? "quiz" : "table";
      this.pushWidget({
        id: ++this.widgetCounter,
        type,
        payload: parsed.data,
      } as WidgetInstance);
      this.emit();
      this.send(functionCallOutput(callId, { ok: true, displayed: true }));
      return;
    }

    if (name === "start_lesson") {
      const parsed = StartLessonArgs.safeParse(args);
      if (!parsed.success || !this.lessonIndex.has(parsed.data.lessonId)) {
        this.send(
          functionCallOutput(callId, { error: "unknown lessonId — use an id from the curriculum" }),
        );
        return;
      }
      this.pendingNav = { kind: "lesson", lessonId: parsed.data.lessonId };
      this.send(functionCallOutput(callId, { ok: true, navigating: true }));
      return;
    }

    if (name === "start_practice") {
      this.pendingNav = { kind: "practice" };
      this.send(functionCallOutput(callId, { ok: true, navigating: true }));
      return;
    }

    this.send(functionCallOutput(callId, { error: `unknown tool ${name}` }));
  }

  private reachCap(): void {
    if (this.capReached || this.phase === "complete" || this.phase === "error") return;
    this.capReached = true;
    if (this.inResponse) {
      this.capPending = true;
      return;
    }
    this.speakWrapUp();
  }

  private speakWrapUp(): void {
    if (this.capSpoken) return;
    this.capSpoken = true;
    this.capPending = false;
    this.send(responseCreate({ kind: "cap", instructions: practiceWrapUp() }));
  }

  /** End gracefully on user request: wrap up now instead of hard-cutting. */
  requestWrapUp(): void {
    if (this.phase === "complete" || this.phase === "error") return;
    this.capReached = true;
    if (this.inResponse) {
      this.capPending = true;
      return;
    }
    this.speakWrapUp();
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
