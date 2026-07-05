export type LessonPair = {
  teacher: string;
  student: string;
};

const TEACHER_PREFIX = "Teacher:";
const STUDENT_PREFIX = "Student:";

/**
 * Port of the Android `ParseLessonUseCase`. Behavior contract:
 * - lines are trimmed; empty lines skipped
 * - consecutive Teacher lines are buffered and joined with "\n"
 * - a Student line closes a pair only if the teacher buffer is non-empty,
 *   and always clears the buffer
 * - lines with any other prefix are ignored without touching the buffer
 */
export function parseLesson(content: string): LessonPair[] {
  const pairs: LessonPair[] = [];
  let teacherBuffer: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith(TEACHER_PREFIX)) {
      const text = line.slice(TEACHER_PREFIX.length).trim();
      if (text) teacherBuffer.push(text);
    } else if (line.startsWith(STUDENT_PREFIX)) {
      const text = line.slice(STUDENT_PREFIX.length).trim();
      if (text && teacherBuffer.length > 0) {
        pairs.push({ teacher: teacherBuffer.join("\n"), student: text });
      }
      teacherBuffer = [];
    }
  }

  return pairs;
}
