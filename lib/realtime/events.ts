// Every OpenAI Realtime API shape lives in this file — if the API drifts,
// this is the single place to fix. Verified against the GA WebRTC docs
// (client_secrets + /v1/realtime/calls + "oai-events" data channel).

import { MEMORY_CATEGORIES } from "@/lib/memory/categories";

// ---------- tools ----------

export const REPORT_ATTEMPT_TOOL = {
  type: "function",
  name: "report_attempt",
  description:
    "Report the student's attempt at the current lesson line. Call this exactly once after the student responds, instead of speaking your judgment.",
  parameters: {
    type: "object",
    properties: {
      transcript: {
        type: "string",
        description: "What the student actually said, transcribed faithfully.",
      },
      accepted: {
        type: "boolean",
        description:
          "true if the words and meaning essentially match the expected answer (ignore accent, hesitation, filler words, minor pronunciation slips). false if words are wrong, missing, or English was used instead of Spanish.",
      },
      feedback: {
        type: "string",
        description:
          "One short sentence of feedback in soft, simple English. For correct attempts a brief acknowledgment; for wrong attempts what was off.",
      },
    },
    required: ["transcript", "accepted", "feedback"],
  },
} as const;

export const UPDATE_MEMORY_TOOL = {
  type: "function",
  name: "update_learner_memory",
  description:
    "Save one durable observation about how THIS student learns, to personalize future lessons. Use sparingly (only for patterns you are confident about, not single mistakes). Learning-related observations only — never personal or sensitive information.",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", enum: [...MEMORY_CATEGORIES] },
      observation: {
        type: "string",
        description:
          "One concise sentence, e.g. 'Confuses ser and estar' or 'Learns fast from English cognate hints'. Max ~140 chars.",
      },
    },
    required: ["category", "observation"],
  },
} as const;

export const GET_LESSON_CONTENT_TOOL = {
  type: "function",
  name: "get_lesson_content",
  description:
    "Fetch the actual Teacher/Student lines of a lesson from the curriculum. Call before drilling or roleplaying a lesson's material so you quote real curriculum phrases.",
  parameters: {
    type: "object",
    properties: {
      lessonId: { type: "string", description: "Lesson id from the curriculum status, e.g. 'lesson2p1'." },
    },
    required: ["lessonId"],
  },
} as const;

export const SUGGEST_LESSON_TOOL = {
  type: "function",
  name: "suggest_lesson",
  description:
    "Recommend a specific lesson for the student to take next. Shows a card they can tap to start it. Also mention the suggestion naturally in speech. At most 2 per session.",
  parameters: {
    type: "object",
    properties: {
      lessonId: { type: "string", description: "Lesson id from the curriculum status, e.g. 'lesson2p3'." },
      reason: { type: "string", description: "One short, personal sentence on why this lesson, in simple English." },
    },
    required: ["lessonId", "reason"],
  },
} as const;

// --- whiteboard tools (practice mode): JSON in, fixed React widgets out ---

export const SHOW_WORD_CARD_TOOL = {
  type: "function",
  name: "show_word_card",
  description:
    "Show an etymology-first word card on the student's screen while you keep talking. Use when teaching or reviewing a word. Include the root and English cognates in etymology; add Persian (FA) or Portuguese (PT) translations when they help this student. The student can mark it Got it / Hard — you'll see the result.",
  parameters: {
    type: "object",
    properties: {
      word: { type: "string", description: "The Spanish word or phrase, e.g. 'poder'." },
      phonetic: { type: "string", description: "Simple pronunciation, e.g. 'po-DER'." },
      category: { type: "string", description: "noun | verb | adjective | phrase | adverb" },
      gender: { type: "string", enum: ["m", "f"], description: "For nouns only." },
      translations: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            lang: { type: "string", description: "EN, FA, PT…" },
            text: { type: "string" },
          },
          required: ["lang", "text"],
        },
      },
      example: { type: "string", description: "One short Spanish sentence using it." },
      pattern: { type: "string", description: "The grammar rule or conjugation formula it follows." },
      etymology: {
        type: "string",
        description: "Root + English cognates + brief history, e.g. 'Latin potere — same root as power, possible, potent.'",
      },
      why: { type: "string", description: "For irregulars: the historical reason (sound shift, stress rule)." },
    },
    required: ["word", "translations"],
  },
} as const;

export const SHOW_QUIZ_TOOL = {
  type: "function",
  name: "show_quiz",
  description:
    "Show a tappable quiz (1–5 questions) on screen. Auto-advances with instant feedback; when finished you receive the score and every miss — react to it by voice and reteach what they missed. Mix in etymology and 'why' questions, not just translations.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            kind: { type: "string", enum: ["choice", "fill"], description: "choice = tap an option; fill = type the answer" },
            options: { type: "array", maxItems: 4, items: { type: "string" }, description: "2–4 options for choice questions" },
            correctIndex: { type: "number", description: "index of the correct option" },
            answer: { type: "string", description: "expected answer for fill questions" },
            why: { type: "string", description: "one-line explanation shown as feedback" },
          },
          required: ["question", "kind"],
        },
      },
    },
    required: ["questions"],
  },
} as const;

export const SHOW_GRAMMAR_TABLE_TOOL = {
  type: "function",
  name: "show_grammar_table",
  description:
    "Show a compact grammar/conjugation table with an optional formula line (grammar as a system, not a list). Use for conjugations, patterns like e→ie stem changes, or side-by-side comparisons.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      formula: { type: "string", description: "The rule as a formula, e.g. 'stress on stem → o becomes ue'." },
      columns: { type: "array", maxItems: 4, items: { type: "string" } },
      rows: { type: "array", maxItems: 8, items: { type: "array", maxItems: 4, items: { type: "string" } } },
      note: { type: "string", description: "One short takeaway under the table." },
    },
    required: ["title", "columns", "rows"],
  },
} as const;

export const FINISH_CHUNK_TOOL = {
  type: "function",
  name: "finish_chunk",
  description:
    "Call silently when the student has said all the current phrases out loud (or everything is reasonably covered). Never mention parts, chunks, or app mechanics to the student — the lesson simply continues.",
  parameters: { type: "object", properties: {} },
} as const;

/** Natural chunk lessons: conversational auto-responses like practice mode. */
export function buildChunkLessonConfig(opts: {
  model: string;
  voice: string;
  instructions: string;
}) {
  const config = buildPracticeSessionConfig(opts);
  return {
    ...config,
    tools: [FINISH_CHUNK_TOOL, UPDATE_MEMORY_TOOL],
  };
}

/** Replace session instructions mid-session (chunk advance without reconnecting). */
export function sessionUpdateInstructions(instructions: string) {
  return { type: "session.update", session: { type: "realtime", instructions } };
}

export const START_LESSON_TOOL = {
  type: "function",
  name: "start_lesson",
  description:
    "Navigate the student into a lesson. Say your short send-off sentence first, then call this.",
  parameters: {
    type: "object",
    properties: {
      lessonId: { type: "string", description: "Lesson id from the curriculum, e.g. 'lesson1p1'." },
    },
    required: ["lessonId"],
  },
} as const;

export const START_PRACTICE_TOOL = {
  type: "function",
  name: "start_practice",
  description:
    "Navigate the student into a free practice session with you. Say your short send-off sentence first, then call this.",
  parameters: { type: "object", properties: {} },
} as const;

// ---------- session config (used by /api/realtime/secret) ----------

/** mini realtime models are non-reasoning and reject the field (verified live) */
function reasoningFor(model: string) {
  return model.includes("mini") ? {} : { reasoning: { effort: "minimal" } };
}

export function buildSessionConfig(opts: {
  model: string;
  voice: string;
  instructions: string;
}) {
  return {
    type: "realtime",
    model: opts.model,
    // grading a repeat-after-me line needs no deep reasoning; hidden reasoning
    // tokens bill as output on EVERY response — keep them at the floor
    ...reasoningFor(opts.model),
    instructions: opts.instructions,
    audio: {
      input: {
        // the API requires an explicit transcription model (verified live 2026-07)
        transcription: {
          model: process.env.REALTIME_TRANSCRIBE_MODEL ?? "gpt-realtime-whisper",
          language: "es",
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "high", // script answers are short — commit fast, less dead air
          create_response: false, // the app scripts every model response
          interrupt_response: true, // barge-in stays native
        },
      },
      output: { voice: opts.voice },
    },
    tools: [REPORT_ATTEMPT_TOOL, UPDATE_MEMORY_TOOL],
    tool_choice: "auto",
  };
}

/**
 * Free-practice config: VAD auto-responses (real conversation), teacher-mode
 * tools. The app only injects the opening/wrap-up and answers tool calls.
 */
export function buildPracticeSessionConfig(opts: {
  model: string;
  voice: string;
  instructions: string;
}) {
  return {
    type: "realtime",
    model: opts.model,
    ...reasoningFor(opts.model),
    instructions: opts.instructions,
    audio: {
      input: {
        transcription: {
          model: process.env.REALTIME_TRANSCRIBE_MODEL ?? "gpt-realtime-whisper",
          language: "es",
        },
        turn_detection: {
          type: "semantic_vad",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: opts.voice },
    },
    tools: [
      UPDATE_MEMORY_TOOL,
      GET_LESSON_CONTENT_TOOL,
      SUGGEST_LESSON_TOOL,
      SHOW_WORD_CARD_TOOL,
      SHOW_QUIZ_TOOL,
      SHOW_GRAMMAR_TABLE_TOOL,
    ],
    tool_choice: "auto",
  };
}

/** Home-screen concierge: like practice, but with navigation tools. */
export function buildGuideSessionConfig(opts: {
  model: string;
  voice: string;
  instructions: string;
}) {
  const config = buildPracticeSessionConfig(opts);
  return {
    ...config,
    tools: [START_LESSON_TOOL, START_PRACTICE_TOOL, UPDATE_MEMORY_TOOL],
  };
}

// ---------- client → server events ----------

export type ResponseKind = "deliver" | "grade" | "outcome" | "complete" | "cap" | "open";

/** Plain continuation after a tool result (no instruction override). */
export function responseContinue() {
  return { type: "response.create" };
}

export function responseCreate(opts: {
  kind: ResponseKind;
  instructions: string;
  textOnly?: boolean;
  forceTool?: string;
}) {
  return {
    type: "response.create",
    response: {
      instructions: opts.instructions,
      metadata: { kind: opts.kind },
      ...(opts.textOnly ? { output_modalities: ["text"] } : {}),
      ...(opts.forceTool ? { tool_choice: { type: "function", name: opts.forceTool } } : {}),
    },
  };
}

/**
 * Out-of-band grading request: reads ONLY the student's answer item (or typed
 * text) instead of the whole conversation — grade input drops from the full
 * context to ~150 tokens, and nothing is appended to the conversation.
 */
export function gradeRequest(opts: {
  instructions: string;
  studentItemId?: string | null;
  studentText?: string | null;
}) {
  const input: object[] = [];
  if (opts.studentItemId) {
    input.push({ type: "item_reference", id: opts.studentItemId });
  } else if (opts.studentText) {
    input.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: opts.studentText }],
    });
  }
  return {
    type: "response.create",
    response: {
      conversation: "none",
      input,
      instructions: opts.instructions,
      metadata: { kind: "grade" },
      output_modalities: ["text"],
      tool_choice: { type: "function", name: "report_attempt" },
    },
  };
}

export function functionCallOutput(callId: string, output: unknown) {
  return {
    type: "conversation.item.create",
    item: {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(output),
    },
  };
}

export function textUserMessage(text: string) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text }],
    },
  };
}

/** Out-of-band context (widget results, background events) — not shown as a student bubble. */
export function systemMessage(text: string) {
  return {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "system",
      content: [{ type: "input_text", text }],
    },
  };
}

export function itemDelete(itemId: string) {
  return { type: "conversation.item.delete", item_id: itemId };
}

// ---------- server → client events (the subset we act on) ----------

export type FunctionCallOutput = {
  type: "function_call";
  id?: string;
  name: string;
  call_id: string;
  arguments: string;
};

export type ResponseUsage = {
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
};

export type ServerEvent = {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export function isFunctionCall(item: unknown): item is FunctionCallOutput {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { type?: string }).type === "function_call"
  );
}

/** Transcript of a finished audio response — event name differs across API revisions. */
export function outputTranscriptDone(ev: ServerEvent): { transcript: string } | null {
  if (
    ev.type === "response.output_audio_transcript.done" ||
    ev.type === "response.audio_transcript.done"
  ) {
    return { transcript: String(ev.transcript ?? "") };
  }
  return null;
}

