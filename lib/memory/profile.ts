import { getDerivedStats, listMemory } from "@/lib/db/queries";
import { getLessonPairs } from "@/lib/lessons/catalog";
import type { LearnerProfile } from "@/lib/lesson-machine/prompts";

const MAX_OBSERVATIONS = 12;
const MAX_CHARS = 1200;

/**
 * Compact learner profile injected into the session persona (≤ ~300 tokens):
 * derived stats computed from user_progress + the teacher's saved observations.
 * Degrades to "first session" when the DB is unreachable — a lesson must
 * always be able to start.
 */
export async function assembleProfile(userId: string): Promise<LearnerProfile> {
  try {
    const [stats, memories] = await Promise.all([getDerivedStats(userId), listMemory(userId)]);
    if (stats.totalAttempts === 0 && memories.length === 0) {
      return { isFirstSession: true, summary: "" };
    }

    const lines: string[] = [
      "What you know about this student (from saved progress and your own past observations):",
    ];
    if (stats.totalAttempts > 0) {
      const pct = stats.accuracy !== null ? Math.round(stats.accuracy * 100) : null;
      lines.push(
        `- Practice so far: ${stats.totalAttempts} attempts${pct !== null ? `, ${pct}% correct` : ""}.`,
      );
    }
    for (const s of stats.strugglingLines.slice(0, 3)) {
      const phrase = getLessonPairs(s.lessonId)[s.lineIndex]?.student;
      if (phrase) lines.push(`- Struggles with «${phrase}» (missed ${s.failCount} times).`);
    }
    for (const m of memories.slice(0, MAX_OBSERVATIONS)) {
      lines.push(`- [${m.category}] ${m.observation}`);
    }

    let summary = lines.join("\n");
    if (summary.length > MAX_CHARS) summary = summary.slice(0, MAX_CHARS);
    return { isFirstSession: false, summary };
  } catch {
    return { isFirstSession: true, summary: "" };
  }
}
