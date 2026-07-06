import { z } from "zod";

// Sofía's whiteboard: structured widget payloads she can render during
// practice. The model fills JSON; React owns the pixels (no generated HTML).
// Every field is hard-capped — the schema is the render contract.

export const LANG_TAG_COLORS: Record<string, string> = {
  // PRD colors: EN blue, FA purple, PT green; ES uses the brand terracotta
  EN: "#0C447C",
  FA: "#3C3489",
  PT: "#27500A",
  ES: "#C2542D",
  FR: "#7A3803",
  DE: "#5A5A00",
  IT: "#155E4B",
};

export const WordCardPayload = z.object({
  word: z.string().min(1).max(60),
  phonetic: z.string().max(80).optional(),
  category: z.string().max(24).optional(), // noun, verb, phrase…
  gender: z.enum(["m", "f"]).nullish(),
  translations: z
    .array(
      z.object({
        lang: z.string().min(2).max(3), // EN, FA, PT…
        text: z.string().min(1).max(90),
      }),
    )
    .min(1)
    .max(4),
  example: z.string().max(180).optional(),
  pattern: z.string().max(260).optional(), // grammar rule / formula
  etymology: z.string().max(300).optional(), // root + cognates + history
  why: z.string().max(300).optional(), // reason behind the irregularity
});
export type WordCard = z.infer<typeof WordCardPayload>;

export const QuizPayload = z
  .object({
    title: z.string().max(80).optional(),
    questions: z
      .array(
        z.object({
          question: z.string().min(1).max(180),
          kind: z.enum(["choice", "fill"]).default("choice"),
          options: z.array(z.string().min(1).max(70)).min(2).max(4).optional(),
          correctIndex: z.number().int().min(0).max(3).optional(),
          answer: z.string().min(1).max(70).optional(),
          why: z.string().max(200).optional(), // shown as feedback after answering
        }),
      )
      .min(1)
      .max(5),
  })
  .superRefine((quiz, ctx) => {
    quiz.questions.forEach((q, i) => {
      if (q.kind === "choice") {
        if (!q.options || q.correctIndex === undefined || q.correctIndex >= q.options.length) {
          ctx.addIssue({
            code: "custom",
            path: ["questions", i],
            message: "choice questions need options and a valid correctIndex",
          });
        }
      } else if (!q.answer) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i],
          message: "fill questions need an answer",
        });
      }
    });
  });
export type Quiz = z.infer<typeof QuizPayload>;

export const GrammarTablePayload = z.object({
  title: z.string().min(1).max(80),
  formula: z.string().max(180).optional(), // monospace pattern line
  columns: z.array(z.string().min(1).max(28)).min(1).max(4),
  rows: z.array(z.array(z.string().max(48)).min(1).max(4)).min(1).max(8),
  note: z.string().max(220).optional(),
});
export type GrammarTable = z.infer<typeof GrammarTablePayload>;

export type WidgetInstance =
  | { id: number; type: "word"; payload: WordCard }
  | { id: number; type: "quiz"; payload: Quiz }
  | { id: number; type: "table"; payload: GrammarTable };

/** Normalized comparison for fill-in answers: trim, lowercase, strip accents. */
export function answersMatch(expected: string, given: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  return norm(expected) === norm(given);
}
