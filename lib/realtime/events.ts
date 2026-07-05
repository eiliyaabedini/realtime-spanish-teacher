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

// ---------- session config (used by /api/realtime/secret) ----------

export function buildSessionConfig(opts: {
  model: string;
  voice: string;
  instructions: string;
}) {
  return {
    type: "realtime",
    model: opts.model,
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

// ---------- client → server events ----------

export type ResponseKind = "deliver" | "grade" | "outcome" | "complete" | "cap";

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

