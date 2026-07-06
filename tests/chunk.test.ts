import { describe, expect, it, vi, afterEach } from "vitest";
import { creditsForUtterance, planChunk, uncoveredLines } from "@/lib/lesson-machine/chunk";
import { ChunkLessonOrchestrator } from "@/lib/realtime/chunk-orchestrator";
import type { ServerEvent } from "@/lib/realtime/events";

const PAIRS = [
  { teacher: "Say: Hola.", student: "Hola." },
  { teacher: "Say: ¿Qué tal?", student: "¿Qué tal?" },
  { teacher: "Say: Todo bien.", student: "Todo bien." },
  { teacher: "Say: Adiós.", student: "Adiós." },
];

describe("chunk planning", () => {
  it("plans the first N uncovered lines", () => {
    const plan = planChunk(PAIRS, new Set(), 2);
    expect(plan.lines.map((l) => l.index)).toEqual([0, 1]);
    expect(plan.chunkNumber).toBe(1);
    expect(plan.totalChunks).toBe(2);
    expect(plan.remainingAfter).toBe(2);
  });

  it("skips credited lines wherever they are", () => {
    const plan = planChunk(PAIRS, new Set([0, 2]), 2);
    expect(plan.lines.map((l) => l.index)).toEqual([1, 3]);
  });

  it("uncoveredLines respects order", () => {
    expect(uncoveredLines(PAIRS, new Set([1])).map((l) => l.index)).toEqual([0, 2, 3]);
  });
});

describe("creditsForUtterance — order-free matching", () => {
  const remaining = uncoveredLines(PAIRS, new Set());

  it("credits the line said, wherever it sits in the chunk", () => {
    expect(creditsForUtterance("todo bien", remaining)).toEqual([2]);
  });

  it("credits multiple phrases said in one breath", () => {
    expect(creditsForUtterance("hola… ¿qué tal? todo bien", remaining)).toEqual([0, 1, 2]);
  });

  it("credits nothing for unrelated speech", () => {
    expect(creditsForUtterance("no entiendo nada de esto", remaining)).toEqual([]);
  });
});

// --- orchestrator ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sent = any;

function setup(chunkSize = 2, initialCredits: number[] = []) {
  const sent: Sent[] = [];
  const hooks = {
    postAttempts: vi.fn(async () => {}),
    postMemory: vi.fn(async () => {}),
    onComplete: vi.fn(),
  };
  const orch = new ChunkLessonOrchestrator({
    lessonId: "lesson1",
    lessonTitle: "Introductions",
    pairs: PAIRS,
    initialCredits,
    chunkSize,
    profileBlock: "",
    send: (e) => sent.push(e),
    hooks,
  });
  return { orch, sent, hooks };
}

const ev = {
  sessionCreated: (): ServerEvent => ({ type: "session.created" }),
  inputTranscript: (t: string): ServerEvent => ({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: t,
  }),
  responseCreated: (): ServerEvent => ({ type: "response.created" }),
  responseDone: (kind?: string): ServerEvent => ({
    type: "response.done",
    response: { metadata: kind ? { kind } : {}, output: [], usage: {} },
  }),
  finishChunk: (): ServerEvent => ({
    type: "response.done",
    response: {
      metadata: {},
      usage: {},
      output: [
        { type: "function_call", name: "finish_chunk", call_id: "fc", arguments: "{}" },
      ],
    },
  }),
};

let active: ChunkLessonOrchestrator | null = null;
afterEach(() => active?.stop());

describe("ChunkLessonOrchestrator", () => {
  it("opens the first chunk on session.created", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    expect(sent[0].response.metadata.kind).toBe("open");
  });

  it("credits spoken phrases and advances the chunk when all are covered", () => {
    const { orch, sent, hooks } = setup(2);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("open"));

    orch.handleServerEvent(ev.inputTranscript("hola"));
    expect(orch.getSnapshot().creditedCount).toBe(1);
    expect(hooks.postAttempts).not.toHaveBeenCalled(); // batched, not per line

    orch.handleServerEvent(ev.inputTranscript("¿qué tal?")); // chunk complete → advance
    expect(hooks.postAttempts).toHaveBeenCalledWith([
      expect.objectContaining({ lineIndex: 0, isCorrect: true }),
      expect.objectContaining({ lineIndex: 1, isCorrect: true }),
    ]);
    const update = sent.find((s) => s.type === "session.update");
    expect(update.session.instructions).toContain("«Todo bien.»");
    expect(update.session.instructions).toContain("part 2 of 2");
    expect(sent.at(-1).response.metadata.kind).toBe("open");
  });

  it("defers chunk advance while Sofía is mid-response", () => {
    const { orch, sent } = setup(2);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("open"));
    orch.handleServerEvent(ev.responseCreated()); // she's talking
    orch.handleServerEvent(ev.inputTranscript("hola ¿qué tal?")); // both credited mid-response

    expect(sent.filter((s) => s.type === "session.update")).toHaveLength(0);
    orch.handleServerEvent(ev.responseDone());
    expect(sent.filter((s) => s.type === "session.update")).toHaveLength(1);
  });

  it("finish_chunk tool advances even with lines uncovered (they roll over)", () => {
    const { orch, sent } = setup(2);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("open"));
    orch.handleServerEvent(ev.inputTranscript("hola"));
    orch.handleServerEvent(ev.finishChunk());

    const update = sent.find((s) => s.type === "session.update");
    // line 1 wasn't credited — the next chunk includes it plus the rest
    expect(update.session.instructions).toContain("«¿Qué tal?»");
    expect(update.session.instructions).toContain("«Todo bien.»");
  });

  it("finishes the lesson when everything is credited", () => {
    const { orch, sent, hooks } = setup(2, [0, 1]);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("open"));
    orch.handleServerEvent(ev.inputTranscript("todo bien y adiós"));

    const complete = sent.at(-1);
    expect(complete.response.metadata.kind).toBe("complete");
    orch.handleServerEvent(ev.responseDone("complete"));
    expect(orch.getSnapshot().phase).toBe("complete");
    expect(hooks.onComplete).toHaveBeenCalledOnce();
  });

  it("memory tool calls post and the conversation continues", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent({
      type: "response.done",
      response: {
        metadata: {},
        usage: {},
        output: [
          {
            type: "function_call",
            name: "update_learner_memory",
            call_id: "m1",
            arguments: JSON.stringify({ category: "pace", observation: "Learns fast with humor" }),
          },
        ],
      },
    });
    expect(hooks.postMemory).toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ type: "response.create" });
  });
});
