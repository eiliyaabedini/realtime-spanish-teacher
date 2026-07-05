import { NextResponse } from "next/server";
import { z } from "zod";
import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/db/queries";
import { getLessonMeta } from "@/lib/lessons/catalog";
import { personaInstructions } from "@/lib/lesson-machine/prompts";
import { assembleProfile } from "@/lib/memory/profile";
import { buildSessionConfig } from "@/lib/realtime/events";
import { DEFAULT_VOICE } from "@/lib/realtime/voices";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({ lessonId: z.string().min(1) });

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !getLessonMeta(parsed.data.lessonId)) {
    return NextResponse.json({ error: "unknown lesson" }, { status: 400 });
  }

  // BYO key first, then the server's shared key
  let apiKey = process.env.OPENAI_API_KEY ?? null;
  let voice = DEFAULT_VOICE as string;
  try {
    const settings = await getSettings(user.id);
    if (settings?.voice) voice = settings.voice;
    if (settings?.openaiApiKeyEnc) {
      try {
        apiKey = decrypt(settings.openaiApiKeyEnc);
      } catch {
        // APP_SECRET rotated — stored key unreadable; fall back to server key
      }
    }
  } catch {
    // DB down — fall through with server key
  }

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "no_api_key",
        message: "No OpenAI API key is configured. Add yours in Settings to start lessons.",
      },
      { status: 400 },
    );
  }

  const profile = await assembleProfile(user.id);
  const session = buildSessionConfig({
    model: process.env.REALTIME_MODEL ?? "gpt-realtime-2",
    voice,
    instructions: personaInstructions(profile),
  });

  const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ session }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    const friendly =
      upstream.status === 401
        ? "OpenAI rejected the API key. Check it in Settings."
        : "Could not start a realtime session.";
    console.error("client_secrets failed", upstream.status, detail);
    return NextResponse.json({ error: "upstream", message: friendly }, { status: 502 });
  }

  const json = await upstream.json();
  const clientSecret: string | undefined = json.value ?? json.client_secret?.value;
  if (!clientSecret) {
    console.error("client_secrets: unexpected response shape", JSON.stringify(json).slice(0, 500));
    return NextResponse.json(
      { error: "upstream", message: "Unexpected response from OpenAI." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    clientSecret,
    expiresAt: json.expires_at ?? json.client_secret?.expires_at ?? null,
    isFirstSession: profile.isFirstSession,
  });
}
