import { getLessonIndex, getLessonMeta } from "@/lib/lessons/catalog";
import { PracticeSession } from "./PracticeSession";

export const dynamic = "force-dynamic";

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ autostart?: string; from?: string; line?: string }>;
}) {
  const sp = await searchParams;
  const lessonIndex = getLessonIndex().map((l) => ({ id: l.id, title: l.title }));

  let from: { lessonId: string; lineIndex: number; title: string } | null = null;
  if (sp.from) {
    const meta = getLessonMeta(sp.from);
    const lineIndex = Number(sp.line);
    if (meta && Number.isInteger(lineIndex) && lineIndex >= 0) {
      from = { lessonId: meta.id, lineIndex, title: meta.title };
    }
  }

  return (
    <PracticeSession lessonIndex={lessonIndex} autostart={sp.autostart === "1"} from={from} />
  );
}
