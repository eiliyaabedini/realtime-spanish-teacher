import { NextResponse } from "next/server";
import { z } from "zod";
import { decrypt } from "@/lib/crypto";
import {
  getCoveredLineIndexes,
  getLastLessonActivityAt,
  getLastPracticeAt,
  getSettings,
} from "@/lib/db/queries";
import { naturalPersona } from "@/lib/lesson-machine/chunkPrompts";
import { deriveNextStep, nextStepBriefing } from "@/lib/guide/journey";
import { guidePersona } from "@/lib/guide/prompts";
import { getLessonMeta, getLessonPairs } from "@/lib/lessons/catalog";
import { personaInstructions } from "@/lib/lesson-machine/prompts";
import { assembleProfile } from "@/lib/memory/profile";
import { curriculumBriefing, getCurriculumStatus } from "@/lib/practice/curriculum";
import { practicePersona } from "@/lib/practice/prompts";
import {
  buildGuideSessionConfig,
  buildNaturalLessonConfig,
  buildPracticeSessionConfig,
  buildSessionConfig,
} from "@/lib/realtime/events";
import { DEFAULT_VOICE } from "@/lib/realtime/voices";
import { getUser } from "@/lib/supabase/server";

const Body = z.union([
  z.object({
    mode: z.literal("practice"),
    from: z
      .object({ lessonId: z.string().min(1), lineIndex: z.number().int().min(0) })
      .optional(),
  }),
  z.object({ mode: z.literal("guide") }),
  z.object({ mode: z.literal("lesson").optional(), lessonId: z.string().min(1) }),
]);

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const body = parsed.data;
  const mode = "lessonId" in body ? "lesson" : body.mode;
  if (mode === "lesson" && !getLessonMeta((body as { lessonId: string }).lessonId)) {
    return NextResponse.json({ error: "unknown lesson" }, { status: 400 });
  }

  // BYO key first, then the server's shared key
  let apiKey = process.env.OPENAI_API_KEY ?? null;
  let voice = DEFAULT_VOICE as string;
  let userModel: string | null = null;
  let lessonMode = "natural";
  try {
    const settings = await getSettings(user.id);
    if (settings?.voice) voice = settings.voice;
    if (settings?.realtimeModel) userModel = settings.realtimeModel;
    if (settings?.lessonMode) lessonMode = settings.lessonMode;
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
  const model = userModel ?? process.env.REALTIME_MODEL ?? "gpt-realtime-2";

  let session: object;
  let lessonExtras: object = {};
  if (mode === "lesson") {
    const lessonId = (body as { lessonId: string }).lessonId;
    if (lessonMode === "natural") {
      // natural mode: warm conversation, but the app drives one phrase at a time
      const credits = await getCoveredLineIndexes(user.id, lessonId).catch(() => [] as number[]);
      const meta = getLessonMeta(lessonId)!;
      const profileBlock = profile.isFirstSession ? "" : `THE STUDENT\n${profile.summary}`;
      session = buildNaturalLessonConfig({
        model,
        voice,
        instructions: naturalPersona({ lessonTitle: meta.title, profileBlock }),
      });
      lessonExtras = { lessonMode: "natural", credits };
    } else {
      session = buildSessionConfig({
        model,
        voice,
        instructions: personaInstructions(profile),
      });
      lessonExtras = { lessonMode: "lines" };
    }
  } else {
    const statuses = await getCurriculumStatus(user.id);
    if (mode === "guide") {
      let lastLessonAt: Date | null = null;
      let lastPracticeAt: Date | null = null;
      try {
        [lastLessonAt, lastPracticeAt] = await Promise.all([
          getLastLessonActivityAt(user.id),
          getLastPracticeAt(user.id),
        ]);
      } catch {
        // DB down — briefing falls back to "first lesson"
      }
      session = buildGuideSessionConfig({
        model,
        voice,
        instructions: guidePersona({
          profile,
          curriculum: curriculumBriefing(statuses),
          stepBriefing: nextStepBriefing(deriveNextStep(statuses, lastLessonAt, lastPracticeAt)),
          isFirstVisit: profile.isFirstSession,
        }),
      });
    } else {
      // free practice — optionally with "just paused a lesson" context
      let instructions = practicePersona(profile, curriculumBriefing(statuses));
      const from = (body as { from?: { lessonId: string; lineIndex: number } }).from;
      if (from && getLessonMeta(from.lessonId)) {
        const pair = getLessonPairs(from.lessonId)[from.lineIndex];
        const badge = from.lessonId.replace(/^lesson(\d+)p(\d+)$/, "$1.$2");
        instructions += `\n\nCONTEXT: the student just paused lesson ${badge} at line ${from.lineIndex + 1}${
          pair ? ` (the line was: «${pair.teacher}»)` : ""
        } to talk with you. Open by acknowledging that and offering to work through what was tricky — then follow their lead. They can resume the lesson from the button on screen whenever they're ready.`;
      }
      session = buildPracticeSessionConfig({ model, voice, instructions });
    }
  }

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
    ...lessonExtras,
  });
}
