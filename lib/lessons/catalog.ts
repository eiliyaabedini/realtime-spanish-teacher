import fs from "node:fs";
import path from "node:path";
import { parseLesson, type LessonPair } from "./parse";

export type LessonMeta = {
  id: string;
  title: string;
  description?: string;
  /** optional custom filename; defaults to `${id}.txt` */
  file?: string;
};

const CONTENT_DIR = path.join(process.cwd(), "lib", "lessons", "content");

let indexCache: LessonMeta[] | null = null;
const pairsCache = new Map<string, LessonPair[]>();

export function getLessonIndex(): LessonMeta[] {
  if (!indexCache) {
    const raw = fs.readFileSync(path.join(CONTENT_DIR, "index.json"), "utf8");
    indexCache = (JSON.parse(raw) as { lessons: LessonMeta[] }).lessons;
  }
  return indexCache;
}

export function getLessonMeta(lessonId: string): LessonMeta | null {
  return getLessonIndex().find((l) => l.id === lessonId) ?? null;
}

export function getLessonPairs(lessonId: string): LessonPair[] {
  const cached = pairsCache.get(lessonId);
  if (cached) return cached;

  const meta = getLessonMeta(lessonId);
  if (!meta) return [];

  const file = meta.file ?? `${meta.id}.txt`;
  const text = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
  const pairs = parseLesson(text);
  pairsCache.set(lessonId, pairs);
  return pairs;
}
