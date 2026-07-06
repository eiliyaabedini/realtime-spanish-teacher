import type { Message } from "@/lib/lesson-machine/machine";

export function ChatBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="bubble-in my-1 text-center">
        <span
          className={`inline-block rounded-full px-3.5 py-1 text-xs ${
            message.isError ? "bg-error-soft text-error" : "bg-surface-2 text-muted"
          }`}
        >
          {message.text}
        </span>
      </div>
    );
  }

  const isTeacher = message.role === "teacher";
  return (
    <div className={`bubble-in flex ${isTeacher ? "justify-start" : "justify-end"}`}>
      {isTeacher && (
        <span
          aria-hidden
          className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-soft text-sm"
        >
          ☀️
        </span>
      )}
      <div
        className={`max-w-[78%] whitespace-pre-wrap rounded-3xl px-4 py-2.5 text-[15px] leading-relaxed shadow-warm ${
          isTeacher
            ? "rounded-tl-md border border-line bg-surface"
            : message.isError
              ? "rounded-br-md bg-error-soft text-error"
              : "rounded-br-md bg-primary text-white"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}
