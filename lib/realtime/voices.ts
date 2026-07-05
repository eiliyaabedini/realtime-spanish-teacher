export const REALTIME_VOICES = ["marin", "cedar", "alloy", "sage", "verse"] as const;
export type RealtimeVoice = (typeof REALTIME_VOICES)[number];
export const DEFAULT_VOICE: RealtimeVoice = "marin";
