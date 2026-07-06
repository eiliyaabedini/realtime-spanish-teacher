import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeOrchestrator } from "@/lib/realtime/practice-orchestrator";
import type { ServerEvent } from "@/lib/realtime/events";

const LESSON_INDEX = [
  { id: "lesson1p1", title: "Introductions" },
  { id: "lesson2p3", title: "Months & Birthdays" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sent = any;

function setup() {
  const sent: Sent[] = [];
  const hooks = {
    postMemory: vi.fn(async () => {}),
    fetchLesson: vi.fn(async (id: string) =>
      id === "lesson1p1"
        ? { title: "Introductions", pairs: [{ teacher: "Say: Hola.", student: "Hola." }] }
        : null,
    ),
    onComplete: vi.fn(),
  };
  const orch = new PracticeOrchestrator({
    send: (e) => sent.push(e),
    hooks,
    lessonIndex: LESSON_INDEX,
  });
  return { orch, sent, hooks };
}

const ev = {
  sessionCreated: (): ServerEvent => ({ type: "session.created" }),
  responseCreated: (): ServerEvent => ({ type: "response.created" }),
  responseDone: (output: unknown[] = [], kind?: string): ServerEvent => ({
    type: "response.done",
    response: { metadata: kind ? { kind } : {}, output, usage: {} },
  }),
  outputTranscript: (t: string): ServerEvent => ({
    type: "response.output_audio_transcript.done",
    transcript: t,
  }),
  inputTranscript: (t: string): ServerEvent => ({
    type: "conversation.item.input_audio_transcription.completed",
    transcript: t,
  }),
  call: (name: string, args: object, callId = "c1") => ({
    type: "function_call",
    name,
    call_id: callId,
    arguments: JSON.stringify(args),
  }),
};

const flush = () => new Promise((r) => setTimeout(r, 0));

let active: PracticeOrchestrator | null = null;
afterEach(() => active?.stop());

describe("PracticeOrchestrator", () => {
  it("sends the opening instruction on session.created", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe("response.create");
    expect(sent[0].response.metadata.kind).toBe("open");
    expect(sent[0].response.instructions).toContain("Greet");
  });

  it("builds the chat from both transcripts", () => {
    const { orch } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.outputTranscript("¡Hola! Ready to practice?"));
    orch.handleServerEvent(ev.inputTranscript("Sí, hola."));
    const snap = orch.getSnapshot();
    expect(snap.messages).toEqual([
      { role: "teacher", text: "¡Hola! Ready to practice?" },
      { role: "student", text: "Sí, hola." },
    ]);
  });

  it("answers get_lesson_content with real lines and continues speaking", async () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone([ev.call("get_lesson_content", { lessonId: "lesson1p1" })]),
    );
    await flush();

    expect(hooks.fetchLesson).toHaveBeenCalledWith("lesson1p1");
    const outputEvent = sent.find((s) => s.type === "conversation.item.create");
    const payload = JSON.parse(outputEvent.item.output);
    expect(payload.title).toBe("Introductions");
    expect(payload.lines).toContain("Say: Hola.");
    expect(sent.at(-1)).toEqual({ type: "response.create" });
  });

  it("records valid lesson suggestions and rejects unknown ids", async () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone([
        ev.call("suggest_lesson", { lessonId: "lesson2p3", reason: "You are ready for months." }, "s1"),
        ev.call("suggest_lesson", { lessonId: "nope", reason: "??" }, "s2"),
      ]),
    );
    await flush();

    const snap = orch.getSnapshot();
    expect(snap.suggestions).toEqual([
      { lessonId: "lesson2p3", title: "Months & Birthdays", reason: "You are ready for months." },
    ]);
    const bad = sent.find(
      (s) => s.type === "conversation.item.create" && s.item.call_id === "s2",
    );
    expect(JSON.parse(bad.item.output).error).toContain("unknown lessonId");
  });

  it("saves memory observations", async () => {
    const { orch, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone([
        ev.call("update_learner_memory", { category: "vocab", observation: "Knows greetings well" }),
      ]),
    );
    await flush();
    expect(hooks.postMemory).toHaveBeenCalledWith({
      category: "vocab",
      observation: "Knows greetings well",
    });
  });

  it("wrap-up request defers while a response is in flight, then completes", async () => {
    const { orch, sent, hooks } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseCreated());
    orch.requestWrapUp(); // mid-response → deferred
    expect(sent.filter((s) => s.response?.metadata?.kind === "cap")).toHaveLength(0);

    orch.handleServerEvent(ev.responseDone());
    await flush();
    expect(sent.filter((s) => s.response?.metadata?.kind === "cap")).toHaveLength(1);

    orch.handleServerEvent(ev.responseDone([], "cap"));
    await flush();
    expect(orch.getSnapshot().phase).toBe("complete");
    expect(hooks.onComplete).toHaveBeenCalledOnce();
  });

  it("start_lesson navigates after the send-off audio delay (guide mode)", async () => {
    vi.useFakeTimers();
    try {
      const sent: Sent[] = [];
      const onNavigate = vi.fn();
      const orch = new PracticeOrchestrator({
        send: (e) => sent.push(e),
        lessonIndex: LESSON_INDEX,
        hooks: {
          postMemory: vi.fn(async () => {}),
          fetchLesson: vi.fn(async () => null),
          onComplete: vi.fn(),
          onNavigate,
        },
        opening: "Welcome them.",
      });
      active = orch;
      orch.handleServerEvent(ev.sessionCreated());
      expect(sent[0].response.instructions).toBe("Welcome them.");

      orch.handleServerEvent(
        ev.responseDone([ev.call("start_lesson", { lessonId: "lesson1p1" })]),
      );
      await vi.advanceTimersByTimeAsync(50);
      expect(onNavigate).not.toHaveBeenCalled(); // send-off still playing
      // no continuation response while navigation is pending
      expect(sent.filter((s) => s.type === "response.create")).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1000);
      expect(onNavigate).toHaveBeenCalledWith({ kind: "lesson", lessonId: "lesson1p1" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("start_lesson with an unknown id is refused without navigating", async () => {
    vi.useFakeTimers();
    try {
      const sent: Sent[] = [];
      const onNavigate = vi.fn();
      const orch = new PracticeOrchestrator({
        send: (e) => sent.push(e),
        lessonIndex: LESSON_INDEX,
        hooks: {
          postMemory: vi.fn(async () => {}),
          fetchLesson: vi.fn(async () => null),
          onComplete: vi.fn(),
          onNavigate,
        },
      });
      active = orch;
      orch.handleServerEvent(ev.sessionCreated());
      orch.handleServerEvent(ev.responseDone([ev.call("start_lesson", { lessonId: "bogus" })]));
      await vi.advanceTimersByTimeAsync(2000);

      expect(onNavigate).not.toHaveBeenCalled();
      const reply = sent.find((s) => s.type === "conversation.item.create");
      expect(JSON.parse(reply.item.output).error).toContain("unknown lessonId");
    } finally {
      vi.useRealTimers();
    }
  });

  it("show_quiz renders a widget into the feed and continues speaking", async () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone([
        ev.call("show_quiz", {
          title: "Stem changes",
          questions: [
            { question: "Poder for yo:", kind: "choice", options: ["puedo", "podo"], correctIndex: 0 },
          ],
        }),
      ]),
    );
    await flush();

    const snap = orch.getSnapshot();
    const widgets = snap.feed.filter((f) => f.kind === "widget");
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ kind: "widget", widget: { type: "quiz" } });
    const output = sent.find((s) => s.type === "conversation.item.create");
    expect(JSON.parse(output.item.output)).toEqual({ ok: true, displayed: true });
    expect(sent.at(-1)).toEqual({ type: "response.create" }); // keeps talking
  });

  it("rejects an invalid widget payload with a fixable error", async () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(
      ev.responseDone([
        ev.call("show_quiz", {
          questions: [{ question: "Broken", kind: "choice" }], // no options/correctIndex
        }),
      ]),
    );
    await flush();

    expect(orch.getSnapshot().feed.filter((f) => f.kind === "widget")).toHaveLength(0);
    const output = sent.find((s) => s.type === "conversation.item.create");
    expect(JSON.parse(output.item.output).error).toContain("invalid payload");
  });

  it("widget results inject immediately when idle", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone()); // opening done → idle

    orch.sendWidgetResult("Quiz finished: 2/3 correct.");
    const sys = sent.find(
      (s) => s.type === "conversation.item.create" && s.item.role === "system",
    );
    expect(sys.item.content[0].text).toContain("[widget result] Quiz finished: 2/3 correct.");
    expect(sent.at(-1)).toEqual({ type: "response.create" });
  });

  it("widget results are gated while Sofía is talking, then flushed", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseCreated()); // response in flight

    orch.sendWidgetResult("Word card «hacer»: student marked HARD.");
    expect(
      sent.filter((s) => s.type === "conversation.item.create" && s.item.role === "system"),
    ).toHaveLength(0); // gated

    orch.handleServerEvent(ev.responseDone()); // she finished → flush
    const sys = sent.find(
      (s) => s.type === "conversation.item.create" && s.item.role === "system",
    );
    expect(sys.item.content[0].text).toContain("HARD");
    expect(sent.at(-1)).toEqual({ type: "response.create" });
  });

  it("cancels replies triggered by Sofía's own echo", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.outputTranscript("Muy bien, ahora vamos a practicar los saludos juntos."));
    const before = orch.getSnapshot().messages.length;

    // her own words leak back through the speaker → mic
    orch.handleServerEvent(ev.inputTranscript("muy bien ahora vamos a practicar los saludos juntos"));
    expect(orch.getSnapshot().messages.length).toBe(before); // not a student bubble
    expect(sent.at(-1)).toEqual({ type: "response.cancel" });

    // a genuine short repeat still goes through
    orch.handleServerEvent(ev.inputTranscript("hola"));
    expect(orch.getSnapshot().messages.at(-1)).toEqual({ role: "student", text: "hola" });
  });

  it("caps chained tool-driven responses until the student speaks again", async () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());

    const memoryCall = () =>
      ev.responseDone([
        ev.call("update_learner_memory", { category: "pace", observation: "Testing chains here" }),
      ]);
    orch.handleServerEvent(memoryCall());
    await flush();
    orch.handleServerEvent(memoryCall());
    await flush();
    const continues = sent.filter((s) => s.type === "response.create" && !s.response).length;
    expect(continues).toBe(2);

    orch.handleServerEvent(memoryCall()); // third chain — capped
    await flush();
    expect(sent.filter((s) => s.type === "response.create" && !s.response).length).toBe(2);
    expect(orch.getSnapshot().phase).toBe("listening");

    orch.handleServerEvent(ev.inputTranscript("sigo aquí")); // student speaks → reset
    orch.handleServerEvent(memoryCall());
    await flush();
    expect(sent.filter((s) => s.type === "response.create" && !s.response).length).toBe(3);
  });

  it("typed answers create a user item and trigger a response", () => {
    const { orch, sent } = setup();
    active = orch;
    orch.handleServerEvent(ev.sessionCreated());
    orch.handleServerEvent(ev.responseDone()); // opening finished
    orch.submitText("Hola, ¿qué tal?");
    const item = sent.find((s) => s.type === "conversation.item.create");
    expect(item.item.content[0].text).toBe("Hola, ¿qué tal?");
    expect(sent.at(-1)).toEqual({ type: "response.create" });
    expect(orch.getSnapshot().messages.at(-1)).toEqual({
      role: "student",
      text: "Hola, ¿qué tal?",
    });
  });
});
