import { getAllLessonStats } from "@/lib/db/queries";
import { getLessonIndex, getLessonPairs } from "@/lib/lessons/catalog";

export type LessonStatus = {
  id: string;
  title: string;
  description?: string;
  totalPairs: number;
  correctLines: number;
  state: "completed" | "in_progress" | "not_started";
};

/** Per-lesson learning status for a user — the teacher's curriculum view. */
export async function getCurriculumStatus(userId: string): Promise<LessonStatus[]> {
  let statsById = new Map<string, { correctLines: number; resumeIndex: number }>();
  try {
    const stats = await getAllLessonStats(userId);
    statsById = new Map(stats.map((s) => [s.lessonId, s]));
  } catch {
    // DB down — treat everything as not started; practice still works
  }

  return getLessonIndex().map((lesson) => {
    const pairs = getLessonPairs(lesson.id);
    const s = statsById.get(lesson.id);
    const correctLines = s?.correctLines ?? 0;
    const state: LessonStatus["state"] =
      pairs.length > 0 && correctLines >= pairs.length
        ? "completed"
        : (s?.resumeIndex ?? 0) > 0 || correctLines > 0
          ? "in_progress"
          : "not_started";
    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      totalPairs: pairs.length,
      correctLines,
      state,
    };
  });
}

/** Compact text table injected into the practice persona (~350 tokens). */
export function curriculumBriefing(statuses: LessonStatus[]): string {
  const lines = statuses.map((s) => {
    const badge = s.id.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
    const progress =
      s.state === "completed"
        ? "COMPLETED"
        : s.state === "in_progress"
          ? `IN PROGRESS (${s.correctLines}/${s.totalPairs} lines)`
          : "NOT STARTED";
    return `- ${badge} "${s.title}" [id: ${s.id}] — ${progress}${s.description ? ` — ${s.description}` : ""}`;
  });
  return `CURRICULUM STATUS (what this student has and hasn't learned):\n${lines.join("\n")}`;
}
