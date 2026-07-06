import { getLastLessonActivityAt, getLastPracticeAt } from "@/lib/db/queries";
import { getCurriculumStatus, type LessonStatus } from "@/lib/practice/curriculum";

// The guided path: lesson → free practice → next lesson → …
// Computed from existing data, never stored — all lessons stay freely clickable.

export type NextStep =
  | {
      kind: "lesson";
      lessonId: string;
      title: string;
      mode: "first" | "start" | "continue";
      resumeLine: number;
      totalPairs: number;
    }
  | { kind: "practice"; reason: "after_lesson" | "all_done" };

export function deriveNextStep(
  statuses: LessonStatus[],
  lastLessonAt: Date | null,
  lastPracticeAt: Date | null,
): NextStep {
  // an unfinished lesson always wins — finish what you started
  const inProgress = statuses.find((s) => s.state === "in_progress");
  if (inProgress) {
    return {
      kind: "lesson",
      lessonId: inProgress.id,
      title: inProgress.title,
      mode: "continue",
      resumeLine: inProgress.resumeIndex,
      totalPairs: inProgress.totalPairs,
    };
  }

  const firstNotStarted = statuses.find((s) => s.state === "not_started");
  const anyCompleted = statuses.some((s) => s.state === "completed");

  // brand-new learner → straight to the first lesson
  if (!anyCompleted && firstNotStarted) {
    return {
      kind: "lesson",
      lessonId: firstNotStarted.id,
      title: firstNotStarted.title,
      mode: statuses[0]?.id === firstNotStarted.id ? "first" : "start",
      resumeLine: 0,
      totalPairs: firstNotStarted.totalPairs,
    };
  }

  // just finished a lesson and haven't practiced since → practice what you learned
  const practicedSinceLastLesson =
    lastPracticeAt !== null && (lastLessonAt === null || lastPracticeAt > lastLessonAt);
  if (anyCompleted && !practicedSinceLastLesson) {
    return { kind: "practice", reason: "after_lesson" };
  }

  if (firstNotStarted) {
    return {
      kind: "lesson",
      lessonId: firstNotStarted.id,
      title: firstNotStarted.title,
      mode: "start",
      resumeLine: 0,
      totalPairs: firstNotStarted.totalPairs,
    };
  }

  return { kind: "practice", reason: "all_done" };
}

export async function computeNextStep(userId: string): Promise<NextStep> {
  const statuses = await getCurriculumStatus(userId);
  let lastLessonAt: Date | null = null;
  let lastPracticeAt: Date | null = null;
  try {
    [lastLessonAt, lastPracticeAt] = await Promise.all([
      getLastLessonActivityAt(userId),
      getLastPracticeAt(userId),
    ]);
  } catch {
    // DB down — statuses are all not_started anyway; first lesson it is
  }
  return deriveNextStep(statuses, lastLessonAt, lastPracticeAt);
}

/** One line for the guide persona so Sofía recommends the same step the UI shows. */
export function nextStepBriefing(step: NextStep): string {
  if (step.kind === "practice") {
    return step.reason === "all_done"
      ? "TODAY'S RECOMMENDED STEP: free practice — every lesson is complete, so conversation and review are the goal now."
      : "TODAY'S RECOMMENDED STEP: a free practice session — they just finished a lesson and should use it in conversation before the next one.";
  }
  const badge = step.lessonId.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
  if (step.mode === "continue") {
    return `TODAY'S RECOMMENDED STEP: continue lesson ${badge} "${step.title}" — they are at line ${step.resumeLine + 1} of ${step.totalPairs}.`;
  }
  if (step.mode === "first") {
    return `TODAY'S RECOMMENDED STEP: their very first lesson, ${badge} "${step.title}".`;
  }
  return `TODAY'S RECOMMENDED STEP: start lesson ${badge} "${step.title}" — they practiced after the last lesson and are ready for new material.`;
}
