export const REALTIME_MODELS = [
  {
    id: "gpt-realtime-2",
    label: "Best quality — gpt-realtime-2",
    hint: "Smartest teacher; audio $32/$64 per 1M tokens",
  },
  {
    id: "gpt-realtime-mini-2025-12-15",
    label: "Economy — gpt-realtime-mini",
    hint: "Great for lessons and everyday practice at a fraction of the price",
  },
] as const;

export type RealtimeModelId = (typeof REALTIME_MODELS)[number]["id"];

export const REALTIME_MODEL_IDS = REALTIME_MODELS.map((m) => m.id) as [string, ...string[]];
