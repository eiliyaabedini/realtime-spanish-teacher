import { describe, expect, it } from "vitest";
import {
  applyAttempt,
  currentPair,
  initMachine,
  MAX_ATTEMPTS,
  type MachineState,
} from "@/lib/lesson-machine/machine";

const PAIRS = [
  { teacher: "Say: Hola.", student: "Hola." },
  { teacher: "Say: Adiós.", student: "Adiós." },
  { teacher: "Say: Gracias.", student: "Gracias." },
];

function fresh(): MachineState {
  return initMachine("test", PAIRS, 0, []);
}

describe("initMachine", () => {
  it("starts at pair 0 with the first teacher line in chat", () => {
    const state = fresh();
    expect(state.currentIndex).toBe(0);
    expect(state.expectingStudent).toBe(true);
    expect(state.messages).toEqual([{ role: "teacher", text: "Say: Hola." }]);
  });

  it("handles empty lessons", () => {
    const state = initMachine("empty", [], 0, []);
    expect(state.isComplete).toBe(true);
    expect(state.messages[0].text).toBe("No lesson content found.");
  });

  it("rebuilds history from actual saved responses with error styling", () => {
    const state = initMachine("test", PAIRS, 2, [
      { lineIndex: 0, userResponse: "Hola.", isCorrect: true },
      { lineIndex: 1, userResponse: "Adios?", isCorrect: false },
    ]);
    expect(state.currentIndex).toBe(2);
    expect(state.messages).toEqual([
      { role: "teacher", text: "Say: Hola." },
      { role: "student", text: "Hola.", isError: false },
      { role: "teacher", text: "Say: Adiós." },
      { role: "student", text: "Adios?", isError: true },
      { role: "teacher", text: "Say: Gracias." },
    ]);
    expect(state.expectingStudent).toBe(true);
  });

  it("shows completion when resume index is past the last pair", () => {
    const state = initMachine("test", PAIRS, 3, [
      { lineIndex: 0, userResponse: "Hola.", isCorrect: true },
      { lineIndex: 1, userResponse: "Adiós.", isCorrect: true },
      { lineIndex: 2, userResponse: "Gracias.", isCorrect: true },
    ]);
    expect(state.isComplete).toBe(true);
    expect(state.messages.at(-1)).toEqual({ role: "system", text: "Lesson complete!" });
  });

  it("clamps a resume index beyond bounds", () => {
    const state = initMachine("test", PAIRS, 99, []);
    expect(state.isComplete).toBe(true);
  });
});

describe("applyAttempt — correct answers", () => {
  it("advances and resets attempts, appending the next teacher line", () => {
    let s = fresh();
    ({ state: s } = applyAttempt(s, { transcript: "Almost", accepted: false }));
    expect(s.attempts).toBe(1);

    const { state, outcome } = applyAttempt(s, { transcript: "Hola.", accepted: true });
    expect(outcome).toEqual({ kind: "advance", next: PAIRS[1] });
    expect(state.currentIndex).toBe(1);
    expect(state.attempts).toBe(0);
    expect(state.messages.at(-2)).toEqual({ role: "student", text: "Hola.", isError: false });
    expect(state.messages.at(-1)).toEqual({ role: "teacher", text: "Say: Adiós." });
  });

  it("completes the lesson on the last pair", () => {
    const s = initMachine("test", PAIRS, 2, []);
    const { state, outcome } = applyAttempt(s, { transcript: "Gracias.", accepted: true });
    expect(outcome).toEqual({ kind: "complete" });
    expect(state.isComplete).toBe(true);
    expect(state.expectingStudent).toBe(false);
    expect(state.messages.at(-1)).toEqual({ role: "system", text: "Lesson complete!" });
  });
});

describe("applyAttempt — wrong answers", () => {
  it("returns retry with feedback for the first two failures", () => {
    const s = fresh();
    const first = applyAttempt(s, { transcript: "Ola", accepted: false, feedback: "Close!" });
    expect(first.outcome).toEqual({ kind: "retry", attemptsUsed: 1, expected: "Hola." });
    expect(first.state.messages.at(-1)).toEqual({
      role: "system",
      text: "Close!",
      isError: true,
    });
    expect(first.state.currentIndex).toBe(0);

    const second = applyAttempt(first.state, { transcript: "Olá", accepted: false });
    expect(second.outcome.kind).toBe("retry");
    expect(second.state.attempts).toBe(2);
  });

  it(`teaches then advances on failure #${MAX_ATTEMPTS}, with "Let's move on." marker`, () => {
    let s = fresh();
    ({ state: s } = applyAttempt(s, { transcript: "a", accepted: false }));
    ({ state: s } = applyAttempt(s, { transcript: "b", accepted: false }));
    const { state, outcome } = applyAttempt(s, { transcript: "c", accepted: false });

    expect(outcome).toEqual({
      kind: "teachThenAdvance",
      correctAnswer: "Hola.",
      next: PAIRS[1],
    });
    expect(state.currentIndex).toBe(1);
    expect(state.attempts).toBe(0);
    const texts = state.messages.map((m) => m.text);
    expect(texts).toContain("Let's move on.");
    expect(state.messages.at(-1)).toEqual({ role: "teacher", text: "Say: Adiós." });
  });

  it("teachThenAdvance on the final pair carries next: null and completes", () => {
    let s = initMachine("test", PAIRS, 2, []);
    ({ state: s } = applyAttempt(s, { transcript: "x", accepted: false }));
    ({ state: s } = applyAttempt(s, { transcript: "y", accepted: false }));
    const { state, outcome } = applyAttempt(s, { transcript: "z", accepted: false });

    expect(outcome).toEqual({ kind: "teachThenAdvance", correctAnswer: "Gracias.", next: null });
    expect(state.isComplete).toBe(true);
    expect(state.messages.at(-1)).toEqual({ role: "system", text: "Lesson complete!" });
  });

  it("ignores attempts after completion", () => {
    const done = initMachine("test", PAIRS, 3, []);
    const { state, outcome } = applyAttempt(done, { transcript: "Hola.", accepted: true });
    expect(outcome).toEqual({ kind: "complete" });
    expect(state).toBe(done);
  });
});

describe("currentPair", () => {
  it("returns the active pair and null when complete", () => {
    expect(currentPair(fresh())).toEqual(PAIRS[0]);
    expect(currentPair(initMachine("test", PAIRS, 3, []))).toBeNull();
  });
});
