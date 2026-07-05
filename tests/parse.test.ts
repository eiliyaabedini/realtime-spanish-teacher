import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLesson } from "@/lib/lessons/parse";

const CONTENT_DIR = path.join(__dirname, "..", "lib", "lessons", "content");

describe("parseLesson — synthetic cases (Android ParseLessonUseCase parity)", () => {
  it("parses simple alternating pairs", () => {
    const pairs = parseLesson("Teacher: Hola.\nStudent: Hola.\nTeacher: Adiós.\nStudent: Adiós.");
    expect(pairs).toEqual([
      { teacher: "Hola.", student: "Hola." },
      { teacher: "Adiós.", student: "Adiós." },
    ]);
  });

  it("joins consecutive Teacher lines with newline", () => {
    const pairs = parseLesson("Teacher: Line one.\nTeacher: Line two.\nStudent: Answer.");
    expect(pairs).toEqual([{ teacher: "Line one.\nLine two.", student: "Answer." }]);
  });

  it("ignores unknown role prefixes without disturbing the teacher buffer", () => {
    const pairs = parseLesson("Teacher: Hola.\nNarrator: scene change\nStudent: Hola.");
    expect(pairs).toEqual([{ teacher: "Hola.", student: "Hola." }]);
  });

  it("drops a Student line that has no preceding Teacher content", () => {
    const pairs = parseLesson("Student: orphan\nTeacher: Hola.\nStudent: Hola.");
    expect(pairs).toEqual([{ teacher: "Hola.", student: "Hola." }]);
  });

  it("clears the buffer on an empty Student line without creating a pair", () => {
    const pairs = parseLesson("Teacher: Hola.\nStudent:\nTeacher: Adiós.\nStudent: Adiós.");
    expect(pairs).toEqual([{ teacher: "Adiós.", student: "Adiós." }]);
  });

  it("skips blank lines and trims whitespace", () => {
    const pairs = parseLesson("\n  Teacher:   Hola.  \n\n  Student: Hola.  \n");
    expect(pairs).toEqual([{ teacher: "Hola.", student: "Hola." }]);
  });
});

describe("parseLesson — real lesson files from the Android app", () => {
  const index = JSON.parse(
    fs.readFileSync(path.join(CONTENT_DIR, "index.json"), "utf8"),
  ) as { lessons: { id: string; file?: string }[] };

  it("has lessons registered in the index", () => {
    expect(index.lessons.length).toBeGreaterThanOrEqual(16);
  });

  for (const lesson of index.lessons) {
    it(`${lesson.id} parses into non-empty pairs`, () => {
      const file = lesson.file ?? `${lesson.id}.txt`;
      const text = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
      const pairs = parseLesson(text);
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) {
        expect(pair.teacher.length).toBeGreaterThan(0);
        expect(pair.student.length).toBeGreaterThan(0);
      }
    });
  }

  it("lesson1p1 starts with the known first pair", () => {
    const text = fs.readFileSync(path.join(CONTENT_DIR, "lesson1p1.txt"), "utf8");
    const pairs = parseLesson(text);
    expect(pairs[0]).toEqual({
      teacher: "Hello welcome to Session 1 Please repeat after me with energy. Hola a todos.",
      student: "Hola a todos.",
    });
  });
});
