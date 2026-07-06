"use client";

import { useRef, useState } from "react";
import { answersMatch, type Quiz } from "@/lib/practice/widgets";

type Answered = { given: string; correct: boolean };

export function QuizWidget({
  quiz,
  onResult,
}: {
  quiz: Quiz;
  onResult: (summary: string) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [feedback, setFeedback] = useState<Answered | null>(null);
  const [fillInput, setFillInput] = useState("");
  const [done, setDone] = useState(false);
  const reported = useRef(false);

  const questions = quiz.questions;
  const q = questions[current];

  function finish(all: Answered[]) {
    setDone(true);
    if (reported.current) return;
    reported.current = true;
    const score = all.filter((a) => a.correct).length;
    const misses = all
      .map((a, i) =>
        a.correct
          ? null
          : `Q${i + 1} "${questions[i].question}" — answered "${a.given}", correct "${expectedOf(i)}"`,
      )
      .filter(Boolean)
      .join("; ");
    onResult(
      `Quiz${quiz.title ? ` "${quiz.title}"` : ""} finished: ${score}/${all.length} correct.${
        misses ? ` Missed: ${misses}` : " Perfect score!"
      }`,
    );
  }

  function expectedOf(i: number): string {
    const question = questions[i];
    return question.kind === "fill"
      ? (question.answer ?? "")
      : (question.options?.[question.correctIndex ?? 0] ?? "");
  }

  function answer(given: string, correct: boolean) {
    if (feedback || done) return;
    const entry = { given, correct };
    const all = [...answers, entry];
    setAnswers(all);
    setFeedback(entry);
    // PRD behavior: show feedback ~2s, then auto-advance
    setTimeout(() => {
      setFeedback(null);
      setFillInput("");
      if (current + 1 >= questions.length) finish(all);
      else setCurrent(current + 1);
    }, 2000);
  }

  if (done) {
    const score = answers.filter((a) => a.correct).length;
    return (
      <div className="bubble-in w-full max-w-md rounded-3xl border border-line bg-surface p-5 text-center shadow-warm">
        <p className="font-display text-2xl font-semibold">
          {score === answers.length ? "¡Perfecto! " : ""}
          {score}/{answers.length}
        </p>
        <p className="mt-1 text-sm text-muted">
          {score === answers.length
            ? "Every answer right — Sofía saw it."
            : "Sofía saw your answers — she'll go over the misses."}
        </p>
      </div>
    );
  }

  return (
    <div className="bubble-in w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-warm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {quiz.title ?? "Quick quiz"}
        </p>
        <span className="text-xs text-muted">
          {current + 1}/{questions.length}
        </span>
      </div>

      <p className="mt-3 font-medium leading-relaxed">{q.question}</p>

      {q.kind === "choice" ? (
        <div className="mt-3 grid gap-2">
          {q.options?.map((option, i) => {
            const isCorrect = i === q.correctIndex;
            const isPicked = feedback?.given === option;
            return (
              <button
                key={i}
                disabled={feedback !== null}
                onClick={() => answer(option, isCorrect)}
                className={`rounded-xl border px-4 py-2.5 text-left text-sm transition ${
                  feedback
                    ? isCorrect
                      ? "border-accent bg-accent-soft text-accent"
                      : isPicked
                        ? "border-error bg-error-soft text-error"
                        : "border-line opacity-50"
                    : "border-line hover:border-primary/50 hover:bg-primary-soft/50"
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fillInput.trim() || feedback) return;
            answer(fillInput.trim(), answersMatch(q.answer ?? "", fillInput));
          }}
        >
          <input
            value={fillInput}
            onChange={(e) => setFillInput(e.target.value)}
            disabled={feedback !== null}
            placeholder="Type your answer…"
            className="min-w-0 flex-1 rounded-xl border border-line bg-background px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-strong disabled:opacity-50">
            Check
          </button>
        </form>
      )}

      {feedback && (
        <p
          className={`mt-3 rounded-xl p-3 text-sm ${
            feedback.correct ? "bg-accent-soft text-accent" : "bg-error-soft text-error"
          }`}
        >
          {feedback.correct ? "✓ Correct!" : `✗ It's "${expectedOf(current)}".`}
          {q.why && <span className="mt-0.5 block opacity-90">{q.why}</span>}
        </p>
      )}
    </div>
  );
}
