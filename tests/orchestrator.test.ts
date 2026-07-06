import { afterEach, describe, expect, it, vi } from "vitest";
import { initMachine } from "@/lib/lesson-machine/machine";
import { LessonOrchestrator } from "@/lib/realtime/orchestrator";
import type { ServerEvent } from "@/lib/realtime/events";

const PAIRS = [
  { teacher: "Say: Hola.", student: "Hola." },
  { teacher: "Say: Adiós.", student: "Adiós." },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sent = any;

function setup(resumeIndex = 0) {
  const sent: Sent[] = [];
  const hooks = {
    postProgress: vi.fn(async () => {}),
    postMemory: vi.fn(async () => {}),
    onComplete: vi.fn(),
  };
  const orch = new LessonOrchestrator({
    machine: initMachine("lesson1", PAIRS, resumeIndex, []),
    send: (e) => sent.push(e),
    hooks,
    greeting: "none",
  });
  return { orch, sent, hooks };
}

const ev = {
  sessionCreated: (): ServerEvent => ({ type: "session.created" }),
  speechStarted: (): ServerEvent => ({ type: "input_audio_buffer.speech_started" }),
  speechStopped: (): ServerEvent => ({ type: "input_audio_buffer.speech_stopped" }),
  committed: (): ServerEvent => ({ type: "input_audio_buffer.committed", item_id: "item_stu" }),
  inputTranscript: (t: string, itemId = "item_stu"): ServerEvent => ({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: itemId,
    transcript: t,
  }),
  itemCreated: (id: string): ServerEvent => ({ type: "conversation.item.created", item: { id } }),
  responseDone: (kind: string, output: unknown[] = [], status = "completed"): ServerEvent => ({
    type: "response.done",
    response: { metadata: { kind }, output, usage: {}, status },
  }),
  error: (type = "invalid_request_error", message = "boom"): ServerEvent => ({
    type: "error",
    error: { type, message },
  }),
  reportCall: (args: object, callId = "call_1") => ({
    type: "function_call",
    name: "report_attempt",
    call_id: callId,
    arguments: JSON.stringify(args),
  }),
};

/** speech + commit only — transcript comes separately */
function commits(orch: LessonOrchestrator) {
  orch.handleServerEvent(ev.speechStarted());
  orch.handleServerEvent(ev.speechStopped());
  orch.handleServerEvent(ev.committed());
}

/** the student says something and the free transcription arrives */
function says(orch: LessonOrchestrator, text: string) {
  commits(orch);
  orch.handleServerEvent(ev.inputTranscript(text));
}

const gradeRequests = (sent: Sent[]) =>
  sent.filter((s) => s.type === "response.create" && s.response?.metadata?.kind === "grade");

let active: LessonOrchestrator | null = null;
afterEach(() => active?.stop());

describe("LessonOrchestrator — local-first grading", () => {
  it("delivers the first line on session.created", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    expect(sent).toHaveLength(1);
    expect(sent[0].response.metadata.kind).toBe("deliver");
    expect(sent[0].response.instructions).toContain("«Say: Hola.»");
  });

  it("clear correct answer never touches the model grader", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Hola.");

    expect(gradeRequests(sent)).toHaveLength(0); // zero function calling
    expect(hooks.postProgress).toHaveBeenCalledWith({
      lessonId: "lesson1",
      lineIndex: 0,
      userResponse: "Hola.",
      isCorrect: true,
    });
    const outcome = sent.at(-1);
    expect(outcome.response.metadata.kind).toBe("outcome");
    expect(outcome.response.instructions).toContain("«Say: Adiós.»");
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("accepts the phrase wrapped in fillers", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "eh… hola, sí");
    expect(gradeRequests(sent)).toHaveLength(0);
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("clear wrong answer retries locally with the student's words in the coaching", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "no tengo ni idea");

    expect(gradeRequests(sent)).toHaveLength(0);
    expect(hooks.postProgress).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect: false, userResponse: "no tengo ni idea" }),
    );
    const outcome = sent.at(-1);
    expect(outcome.response.metadata.kind).toBe("outcome");
    expect(outcome.response.instructions).toContain("attempt 1 of 3");
    expect(outcome.response.instructions).toContain("«no tengo ni idea»");
  });

  it("three local failures → teach-then-advance + a deterministic memory write", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));

    for (const wrong of ["uno", "dos", "tres"]) {
      says(orch, `respuesta equivocada ${wrong}`);
      orch.handleServerEvent(ev.responseDone("outcome"));
    }

    const teach = sent.filter((s) => s.response?.metadata?.kind === "outcome").at(-1);
    expect(teach.response.instructions).toContain("TWICE");
    expect(teach.response.instructions).toContain("«Say: Adiós.»");
    expect(hooks.postMemory).toHaveBeenCalledWith(
      expect.objectContaining({ observation: expect.stringContaining("Struggles with «Hola.»") }),
    );
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
    expect(orch.getSnapshot().machine.messages.map((m) => m.text)).toContain("Let's move on.");
  });

  it("ambiguous answers go to the out-of-band model grader", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Ola"); // similarity in the unsure zone

    const grades = gradeRequests(sent);
    expect(grades).toHaveLength(1);
    expect(grades[0].response.conversation).toBe("none");
    expect(grades[0].response.input).toEqual([{ type: "item_reference", id: "item_stu" }]);
    expect(grades[0].response.tool_choice).toEqual({ type: "function", name: "report_attempt" });

    orch.handleServerEvent(
      ev.responseDone("grade", [
        ev.reportCall({ transcript: "Hola.", accepted: true, feedback: "Nice" }),
      ]),
    );
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("falls back to the model when the transcription never arrives", async () => {
    vi.useFakeTimers();
    try {
      const { orch, sent } = setup();
      active = orch;
      orch.handleServerEvent(ev.sessionCreated());
      orch.handleServerEvent(ev.responseDone("deliver"));
      commits(orch); // no transcript event
      expect(gradeRequests(sent)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2600);
      expect(gradeRequests(sent)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores further commits while a grade is in flight", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Ola"); // → model grade in flight
    const count = sent.length;
    orch.handleServerEvent(ev.committed());
    expect(sent.length).toBe(count);
  });

  it("model ignoring the grade tool twice ends in the exact-match fallback", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Ola");

    orch.handleServerEvent(ev.responseDone("grade")); // no tool call → strict re-ask
    const reAsk = gradeRequests(sent).at(-1);
    expect(reAsk.response.instructions).toContain("must call the report_attempt tool");

    orch.handleServerEvent(ev.responseDone("grade")); // still none → local exact-match
    expect(hooks.postProgress).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect: false, userResponse: "Ola" }),
    );
    expect(orch.getSnapshot().machine.attempts).toBe(1); // retry, lesson alive
  });

  it("a cancelled grade (barge-in) lets the next answer re-grade", () => {
    const { orch, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Ola");
    orch.handleServerEvent(ev.responseDone("grade", [], "cancelled"));

    expect(hooks.postProgress).not.toHaveBeenCalled();
    says(orch, "Hola."); // clear pass this time — resolved locally
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("an error event during grading unlocks the lesson", () => {
    const { orch } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Ola");
    orch.handleServerEvent(ev.error());

    says(orch, "Hola.");
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("refuses a spontaneous report_attempt outside a grade turn", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone("deliver", [
        ev.reportCall({ transcript: "Hola.", accepted: true, feedback: "" }, "rogue"),
      ]),
    );
    expect(hooks.postProgress).not.toHaveBeenCalled();
    expect(orch.getSnapshot().machine.currentIndex).toBe(0);
    const reply = sent.find(
      (s) => s.type === "conversation.item.create" && s.item.call_id === "rogue",
    );
    expect(JSON.parse(reply.item.output).error).toContain("not grading");
  });

  it("prunes old conversation items after advancing", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    for (let i = 0; i < 12; i++) orch.handleServerEvent(ev.itemCreated(`item_${i}`));
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Hola.");

    const deletes = sent.filter((s) => s.type === "conversation.item.delete");
    expect(deletes.length).toBe(4); // 12 items, keep 8
  });

  it("defers the session cap while audio is in flight and fires it after", () => {
    vi.useFakeTimers();
    try {
      const { orch, sent, hooks } = setup();
      active = orch;
      orch.handleServerEvent(ev.sessionCreated()); // deliver in flight
      vi.advanceTimersByTime(21 * 60_000);
      expect(sent.filter((s) => s.response?.metadata?.kind === "cap")).toHaveLength(0);

      orch.handleServerEvent(ev.responseDone("deliver"));
      expect(sent.filter((s) => s.response?.metadata?.kind === "cap")).toHaveLength(1);

      orch.handleServerEvent(ev.responseDone("cap"));
      expect(orch.getSnapshot().phase).toBe("complete");
      expect(hooks.onComplete).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("completing the last line speaks congratulations then fires onComplete", () => {
    const { orch, sent, hooks } = setup(1);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    says(orch, "Adiós."); // local pass on the final pair

    const complete = sent.at(-1);
    expect(complete.response.metadata.kind).toBe("complete");
    orch.handleServerEvent(ev.responseDone("complete"));
    expect(hooks.onComplete).toHaveBeenCalledOnce();
    expect(orch.getSnapshot().phase).toBe("complete");
  });
});
