import { describe, expect, it } from "vitest";
import { deriveNextStep } from "@/lib/guide/journey";
import type { LessonStatus } from "@/lib/practice/curriculum";

function lesson(
  id: string,
  state: LessonStatus["state"],
  overrides: Partial<LessonStatus> = {},
): LessonStatus {
  return {
    id,
    title: id,
    totalPairs: 10,
    correctLines: state === "completed" ? 10 : state === "in_progress" ? 4 : 0,
    resumeIndex: state === "in_progress" ? 4 : 0,
    state,
    ...overrides,
  };
}

const T0 = new Date("2026-07-01T10:00:00Z");
const T1 = new Date("2026-07-02T10:00:00Z");

describe("deriveNextStep — the lesson → practice → lesson journey", () => {
  it("brand-new learner → first lesson with mode 'first'", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "not_started"), lesson("lesson1p2", "not_started")],
      null,
      null,
    );
    expect(step).toMatchObject({ kind: "lesson", lessonId: "lesson1p1", mode: "first" });
  });

  it("an in-progress lesson always wins, with resume line", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "completed"), lesson("lesson1p2", "in_progress")],
      T1,
      T0,
    );
    expect(step).toMatchObject({
      kind: "lesson",
      lessonId: "lesson1p2",
      mode: "continue",
      resumeLine: 4,
    });
  });

  it("completed a lesson without practicing since → practice", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "completed"), lesson("lesson1p2", "not_started")],
      T1, // lesson activity after…
      T0, // …last practice
    );
    expect(step).toEqual({ kind: "practice", reason: "after_lesson" });
  });

  it("never practiced at all after completing → practice", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "completed"), lesson("lesson1p2", "not_started")],
      T1,
      null,
    );
    expect(step).toEqual({ kind: "practice", reason: "after_lesson" });
  });

  it("practiced after the last lesson → next new lesson", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "completed"), lesson("lesson1p2", "not_started")],
      T0,
      T1,
    );
    expect(step).toMatchObject({ kind: "lesson", lessonId: "lesson1p2", mode: "start" });
  });

  it("everything completed → practice forever", () => {
    const step = deriveNextStep(
      [lesson("lesson1p1", "completed"), lesson("lesson1p2", "completed")],
      T0,
      T1,
    );
    expect(step).toEqual({ kind: "practice", reason: "all_done" });
  });
});
