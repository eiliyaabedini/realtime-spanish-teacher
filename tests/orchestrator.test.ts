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
  inputTranscript: (t: string): ServerEvent => ({
    type: "conversation.item.input_audio_transcription.completed",
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

function studentTurn(orch: LessonOrchestrator) {
  orch.handleServerEvent(ev.speechStarted());
  orch.handleServerEvent(ev.speechStopped());
  orch.handleServerEvent(ev.committed());
}

let active: LessonOrchestrator | null = null;
afterEach(() => active?.stop());

describe("LessonOrchestrator turn loop", () => {
  it("delivers the first line on session.created", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("response.create");
    expect(sent[0].response.metadata.kind).toBe("deliver");
    expect(sent[0].response.instructions).toContain("«Say: Hola.»");
  });

  it("grades out-of-band, reading only the student's answer item", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);

    const grade = sent.at(-1);
    expect(grade.type).toBe("response.create");
    expect(grade.response.metadata.kind).toBe("grade");
    expect(grade.response.conversation).toBe("none"); // never re-reads the transcript
    expect(grade.response.input).toEqual([{ type: "item_reference", id: "item_stu" }]);
    expect(grade.response.output_modalities).toEqual(["text"]);
    expect(grade.response.tool_choice).toEqual({ type: "function", name: "report_attempt" });
    expect(grade.response.instructions).toContain("«Hola.»");
    expect(grade.response.instructions).toContain("attempt 1 of 3");
  });

  it("ignores further commits while grading is in flight", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    const count = sent.length;
    orch.handleServerEvent(ev.committed());
    expect(sent.length).toBe(count);
  });

  it("correct answer → progress saved, decision advance, next line spoken", async () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    orch.handleServerEvent(
      ev.responseDone("grade", [
        ev.reportCall({ transcript: "Hola.", accepted: true, feedback: "Nice!" }),
      ]),
    );

    expect(hooks.postProgress).toHaveBeenCalledWith({
      lessonId: "lesson1",
      lineIndex: 0,
      userResponse: "Hola.",
      isCorrect: true,
    });

    // out-of-band grade → no function_call_output item is created
    expect(sent.filter((s) => s.type === "conversation.item.create")).toHaveLength(0);

    const outcome = sent.at(-1);
    expect(outcome.response.metadata.kind).toBe("outcome");
    expect(outcome.response.instructions).toContain("«Say: Adiós.»");
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("three failures → retry, retry, teach_then_advance", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));

    for (const [i, verdict] of (["retry", "retry", "teach"] as const).entries()) {
      studentTurn(orch);
      orch.handleServerEvent(
        ev.responseDone("grade", [
          ev.reportCall({ transcript: `wrong${i}`, accepted: false, feedback: "Not quite" }, `c${i}`),
        ]),
      );
      const outcome = sent.at(-1);
      expect(outcome.response.metadata.kind).toBe("outcome");
      if (verdict === "retry") {
        expect(outcome.response.instructions).toContain(`attempt ${i + 1} of 3`);
        expect(outcome.response.instructions).toContain("«Hola.»");
      } else {
        expect(outcome.response.instructions).toContain("TWICE");
        expect(outcome.response.instructions).toContain("«Say: Adiós.»");
      }
      orch.handleServerEvent(ev.responseDone("outcome"));
    }

    const snap = orch.getSnapshot();
    expect(snap.machine.currentIndex).toBe(1);
    expect(snap.machine.messages.map((m) => m.text)).toContain("Let's move on.");
  });

  it("completing the last line speaks congratulations then fires onComplete", () => {
    const { orch, sent, hooks } = setup(1);
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    orch.handleServerEvent(
      ev.responseDone("grade", [
        ev.reportCall({ transcript: "Adiós.", accepted: true, feedback: "Great" }),
      ]),
    );

    const complete = sent.at(-1);
    expect(complete.response.metadata.kind).toBe("complete");
    expect(hooks.onComplete).not.toHaveBeenCalled();

    orch.handleServerEvent(ev.responseDone("complete"));
    expect(hooks.onComplete).toHaveBeenCalledOnce();
    expect(orch.getSnapshot().phase).toBe("complete");
  });

  it("model ignoring the grade tool twice falls back to exact-match grading", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    orch.handleServerEvent(ev.inputTranscript("Hola."));
    studentTurn(orch);

    orch.handleServerEvent(ev.responseDone("grade")); // no tool call → re-ask
    const reAsk = sent.at(-1);
    expect(reAsk.response.metadata.kind).toBe("grade");
    expect(reAsk.response.instructions).toContain("must call the report_attempt tool");

    orch.handleServerEvent(ev.responseDone("grade")); // still none → local fallback
    expect(hooks.postProgress).toHaveBeenCalledWith(
      expect.objectContaining({ lineIndex: 0, isCorrect: true, userResponse: "Hola." }),
    );
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("update_learner_memory calls post memory and never create an extra response", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    const before = sent.length;
    orch.handleServerEvent(
      ev.responseDone("deliver", [
        {
          type: "function_call",
          name: "update_learner_memory",
          call_id: "m1",
          arguments: JSON.stringify({ category: "pronunciation", observation: "Struggles with rolled R" }),
        },
      ]),
    );

    expect(hooks.postMemory).toHaveBeenCalledWith({
      category: "pronunciation",
      observation: "Struggles with rolled R",
    });
    const newSends = sent.slice(before);
    expect(newSends.filter((s) => s.type === "response.create")).toHaveLength(0);
    expect(newSends.filter((s) => s.type === "conversation.item.create")).toHaveLength(1);
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
    // no extra response.create beyond the initial deliver
    expect(sent.filter((s) => s.type === "response.create")).toHaveLength(1);
  });

  it("a cancelled grade (barge-in) resets grading so the next commit re-grades", () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    orch.handleServerEvent(ev.responseDone("grade", [], "cancelled"));

    expect(hooks.postProgress).not.toHaveBeenCalled(); // not treated as a failed attempt
    studentTurn(orch);
    const grades = sent.filter(
      (s) => s.type === "response.create" && s.response.metadata.kind === "grade",
    );
    expect(grades).toHaveLength(2);
    expect(orch.getSnapshot().machine.currentIndex).toBe(0);
  });

  it("an error event during grading unlocks the lesson for the next attempt", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    orch.handleServerEvent(ev.error());

    expect(orch.getSnapshot().phase).not.toBe("error"); // invalid_request → warning only
    studentTurn(orch);
    const grades = sent.filter(
      (s) => s.type === "response.create" && s.response.metadata.kind === "grade",
    );
    expect(grades).toHaveLength(2);
  });

  it("a second malformed report_attempt falls back to exact-match grading", () => {
    const { orch, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone("deliver"));
    orch.handleServerEvent(ev.inputTranscript("Hola."));
    studentTurn(orch);

    orch.handleServerEvent(
      ev.responseDone("grade", [ev.reportCall({ nonsense: true }, "bad1")]),
    );
    orch.handleServerEvent(
      ev.responseDone("grade", [ev.reportCall({ nonsense: true }, "bad2")]),
    );

    expect(hooks.postProgress).toHaveBeenCalledWith(
      expect.objectContaining({ isCorrect: true, userResponse: "Hola." }),
    );
    expect(orch.getSnapshot().machine.currentIndex).toBe(1);
  });

  it("defers the session cap while audio is in flight and fires it after", () => {
    vi.useFakeTimers();
    try {
      const { orch, sent, hooks } = setup();
      active = orch;
      orch.handleServerEvent(ev.sessionCreated()); // deliver in flight
      vi.advanceTimersByTime(21 * 60_000); // cap fires mid-deliver → deferred

      let caps = sent.filter(
        (s) => s.type === "response.create" && s.response.metadata.kind === "cap",
      );
      expect(caps).toHaveLength(0);

      orch.handleServerEvent(ev.responseDone("deliver"));
      caps = sent.filter(
        (s) => s.type === "response.create" && s.response.metadata.kind === "cap",
      );
      expect(caps).toHaveLength(1);

      orch.handleServerEvent(ev.responseDone("cap"));
      expect(orch.getSnapshot().phase).toBe("complete");
      expect(hooks.onComplete).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prunes old conversation items after advancing", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    for (let i = 0; i < 12; i++) orch.handleServerEvent(ev.itemCreated(`item_${i}`));
    orch.handleServerEvent(ev.responseDone("deliver"));
    studentTurn(orch);
    orch.handleServerEvent(
      ev.responseDone("grade", [
        ev.reportCall({ transcript: "Hola.", accepted: true, feedback: "" }),
      ]),
    );

    const deletes = sent.filter((s) => s.type === "conversation.item.delete");
    expect(deletes.length).toBe(4); // 12 items, keep 8
    expect(deletes[0].item_id).toBe("item_0");
  });
});
