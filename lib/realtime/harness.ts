import type { ResponseUsage } from "./events";

// M1 measurement harness: verbatim drift, turn latency, and session cost.
// Surfaced in the ?debug=1 overlay and logged to the console per turn.

// gpt-realtime-2 pricing, USD per 1M tokens (July 2026).
const PRICE = {
  textIn: 4,
  textInCached: 0.4,
  textOut: 24,
  audioIn: 32,
  audioInCached: 0.4,
  audioOut: 64,
};

export type SessionStats = {
  turnLatenciesMs: number[];
  driftScores: { line: string; spoken: string; score: number }[];
  usdCost: number;
  inputTokens: number;
  outputTokens: number;
};

export function emptyStats(): SessionStats {
  return { turnLatenciesMs: [], driftScores: [], usdCost: 0, inputTokens: 0, outputTokens: 0 };
}

export function addUsage(stats: SessionStats, usage: ResponseUsage | undefined): void {
  if (!usage) return;
  const inDet = usage.input_token_details ?? {};
  const outDet = usage.output_token_details ?? {};
  const cached = inDet.cached_tokens ?? 0;
  const audioIn = inDet.audio_tokens ?? 0;
  const textIn = inDet.text_tokens ?? 0;
  // cached tokens are billed at the cached rate regardless of modality; treat
  // uncached = modality total minus a proportional share of cached tokens
  const uncachedShareAudio = Math.max(0, audioIn - cached * (audioIn / Math.max(1, audioIn + textIn)));
  const uncachedShareText = Math.max(0, textIn - cached * (textIn / Math.max(1, audioIn + textIn)));

  stats.usdCost +=
    (uncachedShareAudio * PRICE.audioIn +
      uncachedShareText * PRICE.textIn +
      cached * PRICE.textInCached +
      (outDet.audio_tokens ?? 0) * PRICE.audioOut +
      (outDet.text_tokens ?? 0) * PRICE.textOut) /
    1_000_000;
  stats.inputTokens += usage.input_tokens ?? 0;
  stats.outputTokens += usage.output_tokens ?? 0;
}

/** Normalized similarity (1 = identical) between the script line and what was spoken. */
export function driftScore(scriptLine: string, spokenTranscript: string): number {
  return similarity(scriptLine, spokenTranscript);
}

/** Accent/case/punctuation-insensitive similarity in [0, 1]. */
export function similarity(expected: string, given: string): number {
  const a = normalize(expected);
  const b = normalize(given);
  if (!a.length && !b.length) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

export function normalizeText(s: string): string {
  return normalize(s);
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents — TTS transcripts vary
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, j) => j);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

export function p50(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

export function meanDrift(stats: SessionStats): number | null {
  if (stats.driftScores.length === 0) return null;
  return stats.driftScores.reduce((acc, d) => acc + d.score, 0) / stats.driftScores.length;
}
