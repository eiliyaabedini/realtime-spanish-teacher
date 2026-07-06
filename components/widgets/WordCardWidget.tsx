"use client";

import { useState } from "react";
import { LANG_TAG_COLORS, type WordCard } from "@/lib/practice/widgets";

export function WordCardWidget({
  card,
  onResult,
}: {
  card: WordCard;
  onResult: (summary: string) => void;
}) {
  const [revealed, setRevealed] = useState(true);
  const [verdict, setVerdict] = useState<"known" | "hard" | null>(null);

  function mark(kind: "known" | "hard") {
    if (verdict) return;
    setVerdict(kind);
    onResult(
      kind === "known"
        ? `Word card «${card.word}»: student marked GOT IT.`
        : `Word card «${card.word}»: student marked HARD — they want more practice on it.`,
    );
  }

  return (
    <div className="bubble-in w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-warm">
      {/* front */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-semibold tracking-tight">
            {card.word}
            {card.gender && (
              <span
                className={`ml-2 align-middle text-sm font-normal ${
                  card.gender === "f" ? "text-primary" : "text-accent"
                }`}
              >
                {card.gender === "f" ? "♀ la" : "♂ el"}
              </span>
            )}
          </p>
          {card.phonetic && <p className="mt-0.5 font-mono text-sm text-muted">{card.phonetic}</p>}
        </div>
        {card.category && (
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
            {card.category}
          </span>
        )}
      </div>

      {revealed && (
        <div className="mt-4 space-y-3">
          {/* layer 1: translations with PRD language colors */}
          <div className="flex flex-wrap gap-2">
            {card.translations.map((t) => (
              <span
                key={t.lang}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-white"
                style={{ background: LANG_TAG_COLORS[t.lang.toUpperCase()] ?? "#555" }}
                dir={t.lang.toUpperCase() === "FA" ? "rtl" : "ltr"}
              >
                <span className="text-[10px] font-bold opacity-80">{t.lang.toUpperCase()}</span>
                {t.text}
              </span>
            ))}
          </div>

          {card.example && (
            <p className="rounded-xl bg-accent-soft p-3 text-sm italic leading-relaxed text-accent">
              {card.example}
            </p>
          )}

          {card.pattern && (
            <div className="rounded-xl bg-[#3C3489]/10 p-3 text-sm leading-relaxed">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#6B5FD6]">
                Pattern
              </p>
              <p className="font-mono text-[13px]">{card.pattern}</p>
            </div>
          )}

          {card.etymology && (
            <div className="rounded-xl bg-gold-soft p-3 text-sm leading-relaxed">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gold">
                Root & cognates
              </p>
              {card.etymology}
            </div>
          )}

          {card.why && (
            <div className="rounded-xl bg-error-soft p-3 text-sm leading-relaxed">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-error">
                Why?
              </p>
              {card.why}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {verdict ? (
          <span
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              verdict === "known" ? "bg-accent-soft text-accent" : "bg-error-soft text-error"
            }`}
          >
            {verdict === "known" ? "✓ Got it" : "Marked hard — Sofía will drill it"}
          </span>
        ) : (
          <>
            <button
              onClick={() => mark("known")}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              ✓ Got it
            </button>
            <button
              onClick={() => mark("hard")}
              className="rounded-full border border-error/40 bg-error-soft px-4 py-1.5 text-sm font-medium text-error transition hover:bg-error/20"
            >
              Hard
            </button>
            <button
              onClick={() => setRevealed((r) => !r)}
              className="ml-auto rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:bg-surface-2"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
