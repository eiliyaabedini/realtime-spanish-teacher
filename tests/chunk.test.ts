import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkLessonOrchestrator } from "@/lib/realtime/chunk-orchestrator";
import type { ServerEvent } from "@/lib/realtime/events";

const PAIRS = [
  { teacher: "How do we greet a group? Hola a todos.", student: "Hola a todos." },
  { teacher: "How's it going? ¿Qué tal?", student: "¿Qué tal?" },
  { teacher: "Everything's fine. Todo bien.", student: "Todo bien." },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sent = any;

function setup(initialCredits: number[] = []) {
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
    send: (e) => sent.push(e),
    hooks,
  });
  return { orch, sent, hooks };
}

const ev = {
  sessionCreated: (): ServerEvent => ({ type: "session.created" }),
  committed: (): ServerEvent => ({ type: "input_audio_buffer.committed", item_id: "s" }),
  inputTranscript: (t: string): ServerEvent => ({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "s",
    transcript: t,
  }),
  responseDone: (kind: string, output: unknown[] = []): ServerEvent => ({
    type: "response.done",
    response: { metadata: { kind }, output, usage: {} },
  }),
  memoryCall: () => ({
    type: "function_call",
    name: "update_learner_memory",
    call_id: "m1",
    arguments: JSON.stringify({ category: "pace", observation: "Learns quickly here" }),
  }),
};

/** student says something and its transcription arrives */
function says(orch: ChunkLessonOrchestrator, text: string) {
  orch.handleServerEvent(ev.committed());
  orch.handleServerEvent(ev.inputTranscript(text));
}

const delivers = (sent: Sent[]) =>
  sent.filter((s) => s.type === "response.create" && s.response?.metadata?.kind === "deliver");

let active: ChunkLessonOrchestrator | null = null;
afterEach(() => active?.stop());

describe("ChunkLessonOrchestrator — guided single-phrase sequence", () => {
  it("delivers exactly the FIRST phrase, verbatim target, on start", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    const first = delivers(sent);
    expect(first).toHaveLength(1);
    expect(first[0].response.instructions).toContain("«Hola a todos.»");
    // never leaks later phrases into a single turn
    expect(first[0].response.instructions).not.toContain("¿Qué tal?");
  });

  it("advances one phrase at a time on a correct answer", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));

    says(orch, "hola a todos");
    expect(orch.getSnapshot().creditedCount).toBe(1);
    const d = delivers(sent).at(-1);
    expect(d.response.instructions).toContain("«¿Qué tal?»"); // exactly the next one
    expect(d.response.instructions).not.toContain("Todo bien");
  });

  it("coaches on the SAME phrase for a wrong answer without advancing", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));

    says(orch, "no tengo ni idea");
    expect(orch.getSnapshot().creditedCount).toBe(0);
    const coach = sent.at(-1);
    expect(coach.response.metadata.kind).toBe("coach");
    expect(coach.response.instructions).toContain("«Hola a todos.»");
    expect(coach.response.instructions).toContain("attempt 1 of 3");
  });

  it("teaches then moves on after 3 failures, saving a struggle memory only at the end", () => {
    const { orch, sent, hooks } = setup([1, 2]); // only the first phrase remains
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));

    says(orch, "no");
    orch.handleServerEvent(ev.responseDone("coach"));
    says(orch, "nope");
    orch.handleServerEvent(ev.responseDone("coach"));
    says(orch, "still no");

    const teach = sent.at(-1);
    expect(teach.response.metadata.kind).toBe("teach");
    expect(teach.response.instructions).toContain("«Hola a todos.»");
    expect(orch.getSnapshot().creditedCount).toBe(3); // all covered now
    expect(hooks.postMemory).toHaveBeenCalledWith(
      expect.objectContaining({ observation: expect.stringContaining("Hola a todos") }),
    );

    orch.handleServerEvent(ev.responseDone("teach")); // last phrase → lesson closes
    expect(sent.at(-1).response.metadata.kind).toBe("complete");
  });

  it("resumes from the covered frontier, not the beginning", () => {
    const { orch, sent } = setup([0]); // first already covered
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    expect(delivers(sent)[0].response.instructions).toContain("«¿Qué tal?»");
    expect(delivers(sent)[0].response.instructions).not.toContain("Hola a todos");
  });

  it("batches progress writes and finishes the lesson", () => {
    const { orch, sent, hooks } = setup([0, 1]); // only last phrase remains
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "todo bien");

    expect(hooks.postAttempts).toHaveBeenCalledWith([
      expect.objectContaining({ lineIndex: 2, isCorrect: true }),
    ]);
    expect(sent.at(-1).response.metadata.kind).toBe("complete");
    orch.handleServerEvent(ev.responseDone("complete"));
    expect(orch.getSnapshot().phase).toBe("complete");
    expect(hooks.onComplete).toHaveBeenCalledOnce();
  });

  it("ignores audio commits while Sofía is speaking (echo safety)", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated()); // deliver in flight, inResponse via response.created
    orch.handleServerEvent({ type: "response.created" } as ServerEvent);
    const before = sent.length;
    orch.handleServerEvent(ev.committed());
    orch.handleServerEvent(ev.inputTranscript("hola a todos"));
    // no grade/advance happened
    expect(sent.length).toBe(before);
    expect(orch.getSnapshot().creditedCount).toBe(0);
  });

  it("handles a memory tool call mid-teaching and continues", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver", [ev.memoryCall()]));
    expect(hooks.postMemory).toHaveBeenCalled();
    expect(sent.at(-1)).toEqual({ type: "response.create" }); // continuation
  });
});
