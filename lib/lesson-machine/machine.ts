import type { LessonPair } from "@/lib/lessons/parse";

// Pure lesson state machine — a port of the Android `LessonSessionUseCase`.
// No I/O: the orchestrator persists attempts and talks to the realtime session;
// this module only decides what happens next.

export type Role = "teacher" | "student" | "system";

export type Message = {
  role: Role;
  text: string;
  isError?: boolean;
};

export type MachineState = {
  lessonId: string;
  pairs: LessonPair[];
  currentIndex: number;
  attempts: number;
  messages: Message[];
  isComplete: boolean;
  expectingStudent: boolean;
};

export type HistoryEntry = { lineIndex: number; userResponse: string; isCorrect: boolean };

export type Outcome =
  | { kind: "advance"; next: LessonPair }
  | { kind: "retry"; attemptsUsed: number; expected: string }
  | { kind: "teachThenAdvance"; correctAnswer: string; next: LessonPair | null }
  | { kind: "complete" };

export const MAX_ATTEMPTS = 3;

/**
 * Build the initial state, rebuilding chat history from saved attempts
 * (Android `buildMessageHistory` parity: teacher line + the user's actual
 * response, error-styled when it was wrong).
 */
export function initMachine(
  lessonId: string,
  pairs: LessonPair[],
  resumeIndex: number,
  history: HistoryEntry[],
): MachineState {
  if (pairs.length === 0) {
    return {
      lessonId,
      pairs,
      currentIndex: 0,
      attempts: 0,
      messages: [{ role: "system", text: "No lesson content found." }],
      isComplete: true,
      expectingStudent: false,
    };
  }

  const byLine = new Map(history.map((h) => [h.lineIndex, h]));
  const messages: Message[] = [];
  const startIndex = Math.min(Math.max(resumeIndex, 0), pairs.length);

  for (let i = 0; i < startIndex; i++) {
    messages.push({ role: "teacher", text: pairs[i].teacher });
    const entry = byLine.get(i);
    if (entry) {
      messages.push({ role: "student", text: entry.userResponse, isError: !entry.isCorrect });
    }
  }

  const currentPair = pairs[startIndex];
  if (!currentPair) {
    return {
      lessonId,
      pairs,
      currentIndex: startIndex,
      attempts: 0,
      messages: [...messages, { role: "system", text: "Lesson complete!" }],
      isComplete: true,
      expectingStudent: false,
    };
  }

  return {
    lessonId,
    pairs,
    currentIndex: startIndex,
    attempts: 0,
    messages: [...messages, { role: "teacher", text: currentPair.teacher }],
    isComplete: false,
    expectingStudent: true,
  };
}

/**
 * Apply a graded attempt. Android parity:
 * - student message appended with isError = !accepted
 * - correct → advance (attempts reset, next teacher line appended)
 * - wrong with attempts left → system feedback message, attempts + 1
 * - 3rd wrong → "Let's move on." system marker, then advance
 *   (the audio layer teaches the answer; the transcript matches Android)
 * - past the last pair → "Lesson complete!"
 */
export function applyAttempt(
  state: MachineState,
  attempt: { transcript: string; accepted: boolean; feedback?: string },
): { state: MachineState; outcome: Outcome } {
  if (!state.expectingStudent || state.isComplete) {
    return { state, outcome: { kind: "complete" } };
  }

  const pair = state.pairs[state.currentIndex];
  const messages: Message[] = [
    ...state.messages,
    { role: "student", text: attempt.transcript, isError: !attempt.accepted },
  ];

  if (attempt.accepted) {
    return advance(state, messages);
  }

  const attempts = state.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    messages.push({ role: "system", text: "Let's move on." });
    const advanced = advance(state, messages);
    return {
      state: advanced.state,
      outcome: {
        kind: "teachThenAdvance",
        correctAnswer: pair.student,
        next: advanced.outcome.kind === "advance" ? advanced.outcome.next : null,
      },
    };
  }

  messages.push({
    role: "system",
    text: attempt.feedback || "Not quite — try again.",
    isError: true,
  });

  return {
    state: { ...state, messages, attempts },
    outcome: { kind: "retry", attemptsUsed: attempts, expected: pair.student },
  };
}

function advance(
  state: MachineState,
  messages: Message[],
): { state: MachineState; outcome: Outcome } {
  const nextIndex = state.currentIndex + 1;
  const nextPair = state.pairs[nextIndex];

  if (!nextPair) {
    return {
      state: {
        ...state,
        messages: [...messages, { role: "system", text: "Lesson complete!" }],
        currentIndex: nextIndex,
        attempts: 0,
        isComplete: true,
        expectingStudent: false,
      },
      outcome: { kind: "complete" },
    };
  }

  return {
    state: {
      ...state,
      messages: [...messages, { role: "teacher", text: nextPair.teacher }],
      currentIndex: nextIndex,
      attempts: 0,
      isComplete: false,
      expectingStudent: true,
    },
    outcome: { kind: "advance", next: nextPair },
  };
}

export function currentPair(state: MachineState): LessonPair | null {
  return state.pairs[state.currentIndex] ?? null;
}
