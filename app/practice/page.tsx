import { getLessonIndex } from "@/lib/lessons/catalog";
import { PracticeSession } from "./PracticeSession";

export const dynamic = "force-dynamic";

export default function PracticePage() {
  const lessonIndex = getLessonIndex().map((l) => ({ id: l.id, title: l.title }));
  return <PracticeSession lessonIndex={lessonIndex} />;
}
