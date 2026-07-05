import type { Message } from "@/lib/lesson-machine/machine";

export function ChatBubble({ message }: { message: Message }) {
  if (message.role === "system") {
    return (
      <div className="my-1 text-center">
        <span
          className={`inline-block rounded-full px-3 py-1 text-xs ${
            message.isError
              ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
          }`}
        >
          {message.text}
        </span>
      </div>
    );
  }

  const isTeacher = message.role === "teacher";
  return (
    <div className={`flex ${isTeacher ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isTeacher
            ? "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
            : message.isError
              ? "rounded-br-sm bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
              : "rounded-br-sm bg-indigo-600 text-white"
        }`}
      >
        {message.text}
      </div>
    </div>
  );
}
