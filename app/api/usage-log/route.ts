import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({
  mode: z.enum(["lesson", "practice", "guide"]),
  usd: z.number().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  seconds: z.number().int().min(0),
});

/** Session usage beacon — lands in Vercel function logs so spend is auditable. */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  console.log(
    `[usage] user=${user.id.slice(0, 8)} mode=${parsed.data.mode} usd=$${parsed.data.usd.toFixed(4)} ` +
      `in=${parsed.data.inputTokens} out=${parsed.data.outputTokens} duration=${parsed.data.seconds}s`,
  );
  return NextResponse.json({ ok: true });
}
