import { normalizeText, similarity } from "@/lib/realtime/harness";

// Local grading for repeat-after-me lines: the input transcription is free,
// so clear passes and clear fails never touch the model. Only the ambiguous
// middle goes to the (out-of-band) model grader.

export type LocalVerdict = "pass" | "fail" | "unsure";

const PASS_AT = 0.82;
const FAIL_BELOW = 0.5;

export function localGrade(expected: string, transcript: string): LocalVerdict {
  const exp = normalizeText(expected);
  const got = normalizeText(transcript);
  if (!got) return "unsure";

  // repeated with a filler around it ("eh… hola a todos, sí") still counts
  if (exp.length >= 4 && got.includes(exp)) return "pass";

  const score = similarity(expected, transcript);
  if (score >= PASS_AT) return "pass";
  if (score < FAIL_BELOW) return "fail";
  return "unsure";
}
