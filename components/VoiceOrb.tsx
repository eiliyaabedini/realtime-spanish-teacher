import type { Snapshot } from "@/lib/realtime/orchestrator";

type OrbState = "idle" | "speaking" | "listening" | "grading";

export function phaseToOrb(phase: Snapshot["phase"], micActive: boolean): OrbState {
  if (micActive) return "listening";
  switch (phase) {
    case "teacher_speaking":
      return "speaking";
    case "listening":
      return "listening";
    case "grading":
      return "grading";
    default:
      return "idle";
  }
}

export function VoiceOrb({ state, size = 88 }: { state: OrbState; size?: number }) {
  return (
    <div
      className={`orb-wrap relative shrink-0 ${state === "listening" ? "orb-listening" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className="orb-ring" />
      <span className="orb-ring" />
      <span className="orb-ring" />
      <div
        className={`orb h-full w-full ${
          state === "speaking" ? "orb-speaking" : state === "grading" ? "orb-grading" : "orb-idle"
        }`}
      >
        <div className="orb-bars">
          {state === "speaking" ? (
            <>
              <span />
              <span />
              <span />
              <span />
              <span />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
