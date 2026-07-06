"use client";

import { useEffect, useRef } from "react";
import type { Message } from "@/lib/lesson-machine/machine";
import { ChatBubble } from "./ChatBubble";

export function TranscriptView({
  messages,
  teacherSpeaking,
}: {
  messages: Message[];
  teacherSpeaking: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, teacherSpeaking]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-4 pb-6">
      {messages.map((m, i) => (
        <ChatBubble key={i} message={m} />
      ))}
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
