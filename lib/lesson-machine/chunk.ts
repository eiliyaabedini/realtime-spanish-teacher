import { localGrade } from "./localGrade";
import type { LessonPair } from "@/lib/lessons/parse";

// Natural chunk mode: Sofía teaches ~N lines as one flowing conversation.
// The app silently credits lines whenever their phrase shows up in what the
// student says (order-free), and rolls uncovered lines into the next chunk.

export type ChunkLine = { index: number; teacher: string; student: string };

export type ChunkPlan = {
  lines: ChunkLine[];
  chunkNumber: number; // 1-based, for display
  totalChunks: number;
  remainingAfter: number;
};

/** Lines not yet credited, in lesson order. */
export function uncoveredLines(pairs: LessonPair[], creditedIndexes: Set<number>): ChunkLine[] {
  return pairs
    .map((p, index) => ({ index, teacher: p.teacher, student: p.student }))
    .filter((l) => !creditedIndexes.has(l.index));
}

export function planChunk(
  pairs: LessonPair[],
  creditedIndexes: Set<number>,
  chunkSize: number,
): ChunkPlan {
  const uncovered = uncoveredLines(pairs, creditedIndexes);
  const size = Math.max(1, chunkSize);
  const lines = uncovered.slice(0, size);
  const done = pairs.length - uncovered.length;
  return {
    lines,
    chunkNumber: Math.floor(done / size) + 1,
    totalChunks: Math.max(1, Math.ceil(pairs.length / size)),
    remainingAfter: Math.max(0, uncovered.length - lines.length),
  };
}

/**
 * Order-free crediting: match one student utterance against every
 * not-yet-credited line of the chunk. Distinct phrases repeat across a lesson,
 * so one utterance may legitimately credit several duplicates.
 */
export function creditsForUtterance(transcript: string, remaining: ChunkLine[]): number[] {
  if (!transcript.trim()) return [];
  const credited: number[] = [];
  for (const line of remaining) {
    if (localGrade(line.student, transcript) === "pass") credited.push(line.index);
  }
  return credited;
}
