import { NextResponse } from "next/server";
import { listMemory, replaceMemory } from "@/lib/db/queries";
import { getUser } from "@/lib/supabase/server";

const MAX_OBSERVATIONS = 30;

/**
 * Post-session compaction: dedupe near-identical observations and cap the
 * total, keeping the most recent. Deterministic (no model call) so it is
 * free and safe to fire after every session.
 */
export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rows = await listMemory(user.id); // newest first
  const seen = new Set<string>();
  const kept: typeof rows = [];
  for (const row of rows) {
    const fingerprint = `${row.category}:${row.observation.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    kept.push(row);
    if (kept.length >= MAX_OBSERVATIONS) break;
  }

  if (kept.length !== rows.length) {
    await replaceMemory(
      user.id,
      // preserve chronological order on re-insert (oldest first)
      [...kept].reverse().map((r) => ({
        category: r.category,
        observation: r.observation,
        source: r.source,
      })),
    );
  }

  return NextResponse.json({ ok: true, kept: kept.length, removed: rows.length - kept.length });
}
