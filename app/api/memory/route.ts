import { NextResponse } from "next/server";
import { z } from "zod";
import { addMemory, deleteAllMemory, deleteMemory } from "@/lib/db/queries";
import { MEMORY_CATEGORIES } from "@/lib/db/schema";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({
  category: z.enum(MEMORY_CATEGORIES),
  observation: z.string().trim().min(3).max(300),
});

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const id = await addMemory(user.id, parsed.data);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  if (searchParams.get("all") === "1") {
    await deleteAllMemory(user.id);
    return NextResponse.json({ ok: true });
  }

  const id = Number(searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }
  await deleteMemory(user.id, id);
  return NextResponse.json({ ok: true });
}
