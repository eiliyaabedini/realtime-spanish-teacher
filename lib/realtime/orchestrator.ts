import { z } from "zod";
import {
  applyAttempt,
  currentPair,
  type MachineState,
  type Outcome,
} from "@/lib/lesson-machine/machine";
import {
  advanceInstructions,
  completeInstructions,
  deliverInstructions,
  gradeInstructions,
  retryInstructions,
  teachThenAdvanceInstructions,
  timeCapInstructions,
} from "@/lib/lesson-machine/prompts";
import {
  functionCallOutput,
  gradeRequest,
  isFunctionCall,
  itemDelete,
  outputTranscriptDone,
  responseCreate,
  textUserMessage,
  type ResponseKind,
  type ServerEvent,
} from "./events";
import { MEMORY_CATEGORIES } from "@/lib/memory/categories";
import { addUsage, driftScore, emptyStats, type SessionStats } from "./harness";

export type SessionPhase =
  | "connecting"
  | "teacher_speaking"
  | "listening"
  | "grading"
  | "complete"
  | "error";

export type Snapshot = {
  phase: SessionPhase;
  machine: MachineState;
  micActive: boolean;
  stats: SessionStats;
  error: string | null;
  warning: string | null;
};

export type OrchestratorHooks = {
  postProgress: (attempt: {
    lessonId: string;
    lineIndex: number;
    userResponse: string;
    isCorrect: boolean;
  }) => Promise<void>;
  postMemory: (entry: { category: string; observation: string }) => Promise<void>;
  onComplete: () => void;
};

const ReportAttemptArgs = z.object({
  transcript: z.string(),
  accepted: z.boolean(),
  feedback: z.string().default(""),
});

const UpdateMemoryArgs = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  observation: z.string().min(3).max(300),
});

const SESSION_CAP_MS = 20 * 60_000;
const IDLE_CAP_MS = 3 * 60_000;
const KEEP_ITEMS = 8;

export class LessonOrchestrator {
  private machine: MachineState;
  private phase: SessionPhase = "connecting";
  private micActive = false;
  private stats = emptyStats();
  private error: string | null = null;
  private warning: string | null = null;

  private send: (event: object) => void;
  private hooks: OrchestratorHooks;
  private greeting: "first" | "returning" | "none";

  private started = false;
  private gradingInFlight = false;
  private gradeRetried = false;
  private itemIds: string[] = [];
  private lastStudentTranscript = "";
  private lastStudentItemId: string | null = null;
  private lastStudentText: string | null = null;
  private speechStoppedAt: number | null = null;

  /** the audio response currently playing (our design keeps them serial) */
  private inFlightAudio: {
    kind: ResponseKind;
    verbatimLine: string | null;
    transcript: string;
    sawFirstAudio: boolean;
  } | null = null;

  // per-session teaching stats for the completion message
  private firstTryCorrect = 0;
  private failsByLine = new Map<number, number>();
  private linesAnsweredThisSession = 0;

  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private capReached = false;
  private capPending = false;

  private listeners = new Set<() => void>();
  private snapshotCache: Snapshot | null = null;

  constructor(opts: {
    machine: MachineState;
    send: (event: object) => void;
    hooks: OrchestratorHooks;
    greeting: "first" | "returning" | "none";
  }) {
    this.machine = opts.machine;
    this.send = opts.send;
    this.hooks = opts.hooks;
    this.greeting = opts.greeting;
  }

  // ---------- public API ----------

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): Snapshot => {
    if (!this.snapshotCache) {
      this.snapshotCache = {
        phase: this.phase,
        machine: this.machine,
        micActive: this.micActive,
        stats: this.stats,
        error: this.error,
        warning: this.warning,
      };
    }
    return this.snapshotCache;
  };

  /** Deliver the current line. Called once the data channel is open. */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.capTimer = setTimeout(() => this.reachCap(), SESSION_CAP_MS);
    this.armIdleTimer();

    if (this.machine.isComplete) {
      this.phase = "complete";
      this.emit();
      return;
    }

    const pair = currentPair(this.machine);
    if (!pair) return;
    this.sendAudioResponse(
      "deliver",
      deliverInstructions(pair.teacher, { greeting: this.greeting }),
      pair.teacher,
    );
  }

  /** Text-input fallback when the mic is unavailable. */
  submitText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.gradingInFlight || this.machine.isComplete) return;
    if (!this.machine.expectingStudent) return;
    this.lastStudentTranscript = trimmed;
    this.lastStudentItemId = null;
    this.lastStudentText = trimmed;
    this.send(textUserMessage(trimmed));
    this.beginGrading();
  }

  stop(): void {
    if (this.capTimer) clearTimeout(this.capTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.listeners.clear();
  }

  // ---------- event handling ----------

  handleServerEvent(ev: ServerEvent): void {
    this.armIdleTimer();

    switch (ev.type) {
      case "session.created":
        this.start();
        return;

      case "input_audio_buffer.speech_started":
        this.micActive = true;
        // barge-in: the server cancels any in-flight audio response itself
        if (this.phase === "teacher_speaking") this.phase = "listening";
        this.emit();
        return;

      case "input_audio_buffer.speech_stopped":
        this.micActive = false;
        this.speechStoppedAt = Date.now();
        this.emit();
        return;

      case "input_audio_buffer.committed": {
        const itemId = typeof ev.item_id === "string" ? ev.item_id : null;
        if (this.machine.expectingStudent && !this.gradingInFlight && !this.machine.isComplete) {
          this.lastStudentItemId = itemId;
          this.lastStudentText = null;
          this.beginGrading();
        }
        return;
      }

      case "conversation.item.created": {
        const id = ev.item?.id;
        if (typeof id === "string" && !this.itemIds.includes(id)) this.itemIds.push(id);
        return;
      }

      case "response.created":
        return;

      case "response.done":
        this.handleResponseDone(ev);
        return;

      case "error": {
        const message: string = ev.error?.message ?? "Realtime session error";
        // a rejected grade response would otherwise soft-lock the lesson —
        // reset so the student's next utterance grades again
        if (this.gradingInFlight) {
          this.gradingInFlight = false;
          this.gradeRetried = false;
          this.phase = this.machine.expectingStudent ? "listening" : this.phase;
        }
        // non-fatal errors (e.g. deleting an already-gone item) → warning only
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

    const inputTranscript =
      ev.type === "conversation.item.input_audio_transcription.completed"
        ? String(ev.transcript ?? "")
        : null;
    if (inputTranscript) {
      this.lastStudentTranscript = inputTranscript;
      return;
    }

    const outDone = outputTranscriptDone(ev);
    if (outDone && this.inFlightAudio) {
      this.inFlightAudio.transcript += outDone.transcript;
      return;
    }

    if (
      (ev.type === "response.output_audio.delta" || ev.type === "response.audio.delta") &&
      this.inFlightAudio &&
      !this.inFlightAudio.sawFirstAudio
    ) {
      this.inFlightAudio.sawFirstAudio = true;
      this.phase = this.phase === "grading" || this.phase === "listening" ? "teacher_speaking" : this.phase;
      if (this.speechStoppedAt !== null) {
        this.stats.turnLatenciesMs.push(Date.now() - this.speechStoppedAt);
        this.speechStoppedAt = null;
      }
      this.emit();
    }
  }

  private handleResponseDone(ev: ServerEvent): void {
    addUsage(this.stats, ev.response?.usage);
    const kind: ResponseKind | undefined = ev.response?.metadata?.kind;
    const cancelled = ev.response?.status === "cancelled";
    const output: unknown[] = Array.isArray(ev.response?.output) ? ev.response.output : [];

    let sawReport = false;
    for (const item of output) {
      if (!isFunctionCall(item)) continue;
      if (item.name === "report_attempt") {
        // only honor the tool inside a grade turn we asked for — the model may
        // call it spontaneously elsewhere, which must never move the lesson
        if (kind === "grade" && this.gradingInFlight) {
          sawReport = true;
          this.handleReportAttempt(item.call_id, item.arguments);
        } else if (kind === "grade") {
          sawReport = true; // stale/out-of-band duplicate — ignore silently
        } else {
          this.send(
            functionCallOutput(item.call_id, {
              error: "not grading right now — wait for the app's next instruction",
            }),
          );
        }
      } else if (item.name === "update_learner_memory") {
        this.handleUpdateMemory(item.call_id, item.arguments);
      }
    }

    if (kind === "grade") {
      if (cancelled) {
        // student barged in while grading — the fresh commit will re-grade
        this.gradingInFlight = false;
        this.gradeRetried = false;
        this.maybeFireCap();
        return;
      }
      if (!sawReport) this.recoverMissingGrade();
      return;
    }

    if (kind === "deliver" || kind === "outcome") {
      this.finishAudioResponse(cancelled);
      if (this.machine.isComplete) {
        this.speakCompletion();
      } else if (this.maybeFireCap()) {
        return;
      } else if (this.machine.expectingStudent && this.phase !== "error") {
        this.phase = "listening";
        this.emit();
      }
      return;
    }

    if (kind === "complete" || kind === "cap") {
      this.finishAudioResponse();
      this.phase = "complete";
      this.emit();
      this.hooks.onComplete();
      return;
    }
  }

  // ---------- grading ----------

  private beginGrading(): void {
    const pair = currentPair(this.machine);
    if (!pair) return;
    this.gradingInFlight = true;
    this.gradeRetried = false;
    this.phase = "grading";
    this.emit();
    this.sendGradeRequest(pair, false);
  }

  /** Out-of-band + narrow input: the grade never re-reads the conversation. */
  private sendGradeRequest(pair: { teacher: string; student: string }, strict: boolean): void {
    const instructions =
      (strict ? "You must call the report_attempt tool now — do not reply with text. " : "") +
      gradeInstructions({
        teacherLine: pair.teacher,
        expected: pair.student,
        attemptNumber: this.machine.attempts + 1,
      });
    this.send(
      gradeRequest({
        instructions,
        studentItemId: this.lastStudentItemId,
        studentText: this.lastStudentText,
      }),
    );
  }

  private handleReportAttempt(callId: string, rawArgs: string): void {
    // the grade is out-of-band (conversation:"none") — no function_call_output
    // is sent back; the app's decision travels in the next response's instructions
    let args: z.infer<typeof ReportAttemptArgs>;
    try {
      args = ReportAttemptArgs.parse(JSON.parse(rawArgs));
    } catch {
      if (!this.gradeRetried) {
        this.gradeRetried = true;
        const pair = currentPair(this.machine);
        if (pair) this.sendGradeRequest(pair, true);
      } else {
        // malformed twice — use the exact-match fallback instead of stalling
        this.recoverMissingGrade();
      }
      return;
    }

    this.gradingInFlight = false;
    const transcript = args.transcript.trim() || this.lastStudentTranscript || "(unclear)";
    const lineIndex = this.machine.currentIndex;

    // session teaching stats
    if (args.accepted && this.machine.attempts === 0) this.firstTryCorrect++;
    if (!args.accepted) {
      this.failsByLine.set(lineIndex, (this.failsByLine.get(lineIndex) ?? 0) + 1);
    }
    if (args.accepted || this.machine.attempts + 1 >= 3) this.linesAnsweredThisSession++;

    void this.hooks
      .postProgress({
        lessonId: this.machine.lessonId,
        lineIndex,
        userResponse: transcript,
        isCorrect: args.accepted,
      })
      .catch(() => {
        this.warning = "Progress could not be saved — check your connection.";
        this.emit();
      });

    const { state, outcome } = applyAttempt(this.machine, {
      transcript,
      accepted: args.accepted,
      feedback: args.feedback,
    });
    this.machine = state;
    this.respondToOutcome(outcome);
    this.emit();
  }

  /** The model ignored the forced tool — fall back to exact match so the lesson never stalls. */
  private recoverMissingGrade(): void {
    if (!this.gradingInFlight) return;
    const pair = currentPair(this.machine);
    if (!pair) return;

    if (!this.gradeRetried) {
      this.gradeRetried = true;
      this.sendGradeRequest(pair, true);
      return;
    }

    // Android CheckAnswerExactUseCase parity as the last resort
    this.gradingInFlight = false;
    const transcript = this.lastStudentTranscript || "";
    const accepted = normalizeAnswer(transcript) === normalizeAnswer(pair.student);
    const lineIndex = this.machine.currentIndex;
    const { state, outcome } = applyAttempt(this.machine, {
      transcript: transcript || "(unclear)",
      accepted,
      feedback: accepted ? "" : "Not quite — try again.",
    });
    this.machine = state;
    void this.hooks
      .postProgress({
        lessonId: state.lessonId,
        lineIndex,
        userResponse: transcript || "(unclear)",
        isCorrect: accepted,
      })
      .catch(() => {});
    this.respondToOutcome(outcome);
    this.emit();
  }

  private respondToOutcome(outcome: Outcome): void {
    switch (outcome.kind) {
      case "advance":
        this.pruneItems();
        this.sendAudioResponse("outcome", advanceInstructions(outcome.next.teacher), outcome.next.teacher);
        return;
      case "retry":
        this.sendAudioResponse(
          "outcome",
          retryInstructions({
            expected: outcome.expected,
            attemptsUsed: outcome.attemptsUsed,
            attemptsLeft: 3 - outcome.attemptsUsed,
          }),
          null,
        );
        return;
      case "teachThenAdvance":
        this.pruneItems();
        this.sendAudioResponse(
          "outcome",
          teachThenAdvanceInstructions({
            correctAnswer: outcome.correctAnswer,
            nextLine: outcome.next?.teacher ?? null,
          }),
          outcome.next?.teacher ?? null,
        );
        return;
      case "complete":
        this.speakCompletion();
        return;
    }
  }

  private speakCompletion(): void {
    if (this.phase === "complete") return;
    const hardestEntry = [...this.failsByLine.entries()].sort((a, b) => b[1] - a[1])[0];
    const hardestLine =
      hardestEntry && hardestEntry[1] >= 2
        ? (this.machine.pairs[hardestEntry[0]]?.student ?? null)
        : null;
    this.sendAudioResponse(
      "complete",
      completeInstructions({
        totalLines: Math.max(this.linesAnsweredThisSession, 1),
        correctFirstTry: this.firstTryCorrect,
        hardestLine,
      }),
      null,
    );
  }

  private reachCap(): void {
    if (this.capReached || this.phase === "complete" || this.phase === "error") return;
    this.capReached = true;
    // a second active response would be rejected — defer to the next response.done
    if (this.inFlightAudio || this.gradingInFlight) {
      this.capPending = true;
      return;
    }
    this.sendAudioResponse("cap", timeCapInstructions(), null);
  }

  /** Fire a deferred session cap once nothing is in flight. Returns true if fired. */
  private maybeFireCap(): boolean {
    if (!this.capPending || this.phase === "complete" || this.phase === "error") return false;
    if (this.inFlightAudio || this.gradingInFlight) return false;
    this.capPending = false;
    this.sendAudioResponse("cap", timeCapInstructions(), null);
    return true;
  }

  // ---------- helpers ----------

  private handleUpdateMemory(callId: string, rawArgs: string): void {
    try {
      const args = UpdateMemoryArgs.parse(JSON.parse(rawArgs));
      void this.hooks.postMemory(args).catch(() => {});
      this.send(functionCallOutput(callId, { ok: true }));
    } catch {
      this.send(functionCallOutput(callId, { ok: false, error: "invalid arguments" }));
    }
    // never create a response for memory calls — audio flow continues on its own
  }

  private sendAudioResponse(
    kind: ResponseKind,
    instructions: string,
    verbatimLine: string | null,
  ): void {
    this.inFlightAudio = { kind, verbatimLine, transcript: "", sawFirstAudio: false };
    this.phase = kind === "grade" ? "grading" : this.phase;
    this.send(responseCreate({ kind, instructions }));
    this.emit();
  }

  private finishAudioResponse(cancelled = false): void {
    const audio = this.inFlightAudio;
    this.inFlightAudio = null;
    // barge-in cancels mid-line — a drift score on partial audio would be noise
    if (cancelled || !audio || !audio.verbatimLine || !audio.transcript) return;
    // the spoken transcript may include an ack/greeting before the line — score
    // against the tail window where the script line should live
    const score = driftScore(audio.verbatimLine, tailWindow(audio.transcript, audio.verbatimLine));
    this.stats.driftScores.push({
      line: audio.verbatimLine,
      spoken: audio.transcript,
      score,
    });
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[harness] drift=${score.toFixed(3)} line="${audio.verbatimLine}"`);
    }
  }

  private pruneItems(): void {
    if (this.itemIds.length <= KEEP_ITEMS) return;
    const toDelete = this.itemIds.slice(0, this.itemIds.length - KEEP_ITEMS);
    this.itemIds = this.itemIds.slice(this.itemIds.length - KEEP_ITEMS);
    for (const id of toDelete) this.send(itemDelete(id));
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

/** Android CheckAnswerExactUseCase parity: trim + case-insensitive compare. */
function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase();
}

/** Last portion of the spoken transcript sized to the script line (for drift). */
function tailWindow(spoken: string, line: string): string {
  const extra = Math.ceil(line.length * 1.25);
  return spoken.length <= extra ? spoken : spoken.slice(spoken.length - extra);
}
