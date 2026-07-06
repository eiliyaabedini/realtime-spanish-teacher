import { NextResponse } from "next/server";
import { z } from "zod";
import { encrypt } from "@/lib/crypto";
import { upsertSettings } from "@/lib/db/queries";
import { REALTIME_MODEL_IDS } from "@/lib/realtime/models";
import { REALTIME_VOICES } from "@/lib/realtime/voices";
import { getSettingsStatus } from "@/lib/settings";
import { getUser } from "@/lib/supabase/server";

const PostBody = z.object({
  apiKey: z
    .string()
    .trim()
    .regex(/^sk-[A-Za-z0-9_-]{16,}$/, "That doesn't look like an OpenAI API key")
    .optional(),
  voice: z.enum(REALTIME_VOICES).optional(),
  model: z.enum(REALTIME_MODEL_IDS).optional(),
  lessonMode: z.enum(["natural", "lines"]).optional(),
  chunkSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).optional(),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = PostBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid body" },
      { status: 400 },
    );
  }

  const { apiKey, voice, model, lessonMode, chunkSize } = parsed.data;
  const values: {
    openaiApiKeyEnc?: string;
    voice?: string;
    realtimeModel?: string;
    lessonMode?: string;
    chunkSize?: number;
  } = {};
  if (apiKey) values.openaiApiKeyEnc = encrypt(apiKey);
  if (voice) values.voice = voice;
  if (model) values.realtimeModel = model;
  if (lessonMode) values.lessonMode = lessonMode;
  if (chunkSize) values.chunkSize = chunkSize;
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  await upsertSettings(user.id, values);
  return NextResponse.json(await getSettingsStatus(user.id));
}

export async function DELETE() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  await upsertSettings(user.id, { openaiApiKeyEnc: null });
  return NextResponse.json(await getSettingsStatus(user.id));
}
