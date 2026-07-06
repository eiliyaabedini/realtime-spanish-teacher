"use client";

import { useEffect, useRef } from "react";
import { ChatBubble } from "@/components/ChatBubble";
import type { FeedItem } from "@/lib/realtime/practice-orchestrator";
import { GrammarTableWidget } from "./GrammarTableWidget";
import { QuizWidget } from "./QuizWidget";
import { WordCardWidget } from "./WordCardWidget";

export function PracticeFeed({
  feed,
  teacherSpeaking,
  onWidgetResult,
  widgetStyle = "interactive",
}: {
  feed: FeedItem[];
  teacherSpeaking: boolean;
  onWidgetResult: (summary: string) => void;
  /** "compact" renders widgets as chips — used in the transcript drawer where
   *  the live interactive instances already exist on the stage */
  widgetStyle?: "interactive" | "compact";
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed.length, teacherSpeaking]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 pb-6">
      {feed.map((item, i) =>
        item.kind === "message" ? (
          <ChatBubble key={`m-${i}`} message={item.message} />
        ) : widgetStyle === "compact" ? (
          <div key={`w-${item.widget.id}`} className="flex justify-start pl-9">
            <span className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-xs text-muted">
              {item.widget.type === "word"
                ? `📇 Word card — «${item.widget.payload.word}»`
                : item.widget.type === "quiz"
                  ? `📝 Quiz — ${item.widget.payload.title ?? `${item.widget.payload.questions.length} questions`}`
                  : `📐 ${item.widget.payload.title}`}
            </span>
          </div>
        ) : (
          <div key={`w-${item.widget.id}`} className="flex justify-start pl-9">
            {item.widget.type === "word" ? (
              <WordCardWidget card={item.widget.payload} onResult={onWidgetResult} />
            ) : item.widget.type === "quiz" ? (
              <QuizWidget quiz={item.widget.payload} onResult={onWidgetResult} />
            ) : (
              <GrammarTableWidget table={item.widget.payload} />
            )}
          </div>
        ),
      )}
      {teacherSpeaking && (
        <div className="bubble-in flex justify-start">
          <span
            aria-hidden
            className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-soft text-sm"
          >
            ☀️
          </span>
          <div className="rounded-3xl rounded-tl-md border border-line bg-surface px-4 py-3 shadow-warm">
            <span className="inline-flex gap-1.5">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-muted" />
            </span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
