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
    <div className="flex flex-col gap-2 overflow-y-auto p-4">
      {messages.map((m, i) => (
        <ChatBubble key={i} message={m} />
      ))}
      {teacherSpeaking && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
            <span className="inline-flex gap-1">
              <Dot delay="0ms" />
              <Dot delay="150ms" />
              <Dot delay="300ms" />
            </span>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400"
      style={{ animationDelay: delay }}
    />
  );
}
