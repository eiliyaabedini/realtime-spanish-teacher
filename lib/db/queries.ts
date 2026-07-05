import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { learnerMemory, userProgress, userSettings, type MemoryCategory } from "./schema";

// Every function takes the authenticated userId as its first argument and scopes
// all reads/writes to it. This is the enforcement line (Drizzle connects as the
// postgres role, so RLS does not apply here).

// --- progress ---

export async function recordAttempt(
  userId: string,
  attempt: { lessonId: string; lineIndex: number; userResponse: string; isCorrect: boolean },
) {
  await db().insert(userProgress).values({ userId, ...attempt });
}

/**
 * Android-parity resume rule (UserProgressDao.getResumeIndex):
 * look at the highest answered lineIndex — if any attempt on it was correct,
 * resume at lineIndex + 1, otherwise resume at that lineIndex. 0 when no rows.
 */
export async function getResumeIndex(userId: string, lessonId: string): Promise<number> {
  const rows = await db()
    .select({
      maxLine: sql<number>`max(${userProgress.lineIndex})`,
      anyCorrect: sql<boolean>`bool_or(${userProgress.isCorrect})`,
    })
    .from(userProgress)
    .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, lessonId)))
    .groupBy(userProgress.lessonId);

  const row = rows[0];
  if (!row || row.maxLine === null) return 0;
  return row.anyCorrect ? row.maxLine + 1 : row.maxLine;
}

export type HistoryRow = { lineIndex: number; userResponse: string; isCorrect: boolean };

/**
 * First attempt per line (Android getProgressForLine parity: LIMIT 1 in insertion
 * order), ordered by lineIndex — used to rebuild the chat on resume.
 */
export async function getLessonHistory(userId: string, lessonId: string): Promise<HistoryRow[]> {
  const rows = await db()
    .selectDistinctOn([userProgress.lineIndex], {
      lineIndex: userProgress.lineIndex,
      userResponse: userProgress.userResponse,
      isCorrect: userProgress.isCorrect,
    })
    .from(userProgress)
    .where(and(eq(userProgress.userId, userId), eq(userProgress.lessonId, lessonId)))
    .orderBy(asc(userProgress.lineIndex), asc(userProgress.id));
  return rows;
}

export type LessonStats = { lessonId: string; correctLines: number; resumeIndex: number };

/** Per-lesson stats for the catalog: distinct correct lines + resume index. */
export async function getAllLessonStats(userId: string): Promise<LessonStats[]> {
  const rows = await db()
    .select({
      lessonId: userProgress.lessonId,
      correctLines: sql<number>`count(distinct ${userProgress.lineIndex}) filter (where ${userProgress.isCorrect})`,
      maxLine: sql<number>`max(${userProgress.lineIndex})`,
      lastLineCorrect: sql<boolean>`bool_or(${userProgress.isCorrect}) filter (where ${userProgress.lineIndex} = (
        select max(p2.line_index) from user_progress p2
        where p2.user_id = ${userProgress.userId} and p2.lesson_id = ${userProgress.lessonId}
      ))`,
    })
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .groupBy(userProgress.userId, userProgress.lessonId);

  return rows.map((r) => ({
    lessonId: r.lessonId,
    correctLines: Number(r.correctLines),
    resumeIndex: r.lastLineCorrect ? Number(r.maxLine) + 1 : Number(r.maxLine),
  }));
}

/** Consecutive practice days ending today or yesterday (UTC). */
export async function getStreak(userId: string): Promise<number> {
  const rows = await db()
    .select({ day: sql<string>`(${userProgress.createdAt} at time zone 'utc')::date` })
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .groupBy(sql`1`)
    .orderBy(sql`1 desc`);

  const days = rows.map((r) => new Date(`${r.day}T00:00:00Z`).getTime());
  if (days.length === 0) return 0;

  const DAY = 86_400_000;
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  // Streak survives if the most recent practice day is today or yesterday.
  if (todayUtc - days[0] > DAY) return 0;

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === DAY) streak++;
    else break;
  }
  return streak;
}

// --- learner memory ---

export type MemoryRow = {
  id: number;
  category: MemoryCategory;
  observation: string;
  source: string;
  createdAt: Date;
};

export async function listMemory(userId: string): Promise<MemoryRow[]> {
  return db()
    .select({
      id: learnerMemory.id,
      category: learnerMemory.category,
      observation: learnerMemory.observation,
      source: learnerMemory.source,
      createdAt: learnerMemory.createdAt,
    })
    .from(learnerMemory)
    .where(eq(learnerMemory.userId, userId))
    .orderBy(desc(learnerMemory.createdAt));
}

export async function addMemory(
  userId: string,
  entry: { category: MemoryCategory; observation: string; source?: string },
): Promise<number> {
  const [row] = await db()
    .insert(learnerMemory)
    .values({ userId, source: "teacher", ...entry })
    .returning({ id: learnerMemory.id });
  return row.id;
}

export async function deleteMemory(userId: string, id: number) {
  await db()
    .delete(learnerMemory)
    .where(and(eq(learnerMemory.userId, userId), eq(learnerMemory.id, id)));
}

export async function deleteAllMemory(userId: string) {
  await db().delete(learnerMemory).where(eq(learnerMemory.userId, userId));
}

export async function replaceMemory(
  userId: string,
  entries: { category: MemoryCategory; observation: string; source?: string }[],
) {
  await db().transaction(async (tx) => {
    await tx.delete(learnerMemory).where(eq(learnerMemory.userId, userId));
    if (entries.length > 0) {
      await tx
        .insert(learnerMemory)
        .values(entries.map((e) => ({ userId, source: "teacher", ...e })));
    }
  });
}

// --- user settings ---

export type SettingsRow = { openaiApiKeyEnc: string | null; voice: string };

export async function getSettings(userId: string): Promise<SettingsRow | null> {
  const rows = await db()
    .select({ openaiApiKeyEnc: userSettings.openaiApiKeyEnc, voice: userSettings.voice })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return rows[0] ?? null;
}

export async function upsertSettings(
  userId: string,
  values: { openaiApiKeyEnc?: string | null; voice?: string },
) {
  await db()
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...values, updatedAt: sql`now()` },
    });
}

/** Compact derived stats for the learner profile injected into session instructions. */
export type DerivedStats = {
  totalAttempts: number;
  accuracy: number | null;
  strugglingLines: { lessonId: string; lineIndex: number; failCount: number }[];
};

export async function getDerivedStats(userId: string): Promise<DerivedStats> {
  const [totals] = await db()
    .select({
      total: sql<number>`count(*)`,
      correct: sql<number>`count(*) filter (where ${userProgress.isCorrect})`,
    })
    .from(userProgress)
    .where(eq(userProgress.userId, userId));

  const struggling = await db()
    .select({
      lessonId: userProgress.lessonId,
      lineIndex: userProgress.lineIndex,
      failCount: sql<number>`count(*) filter (where not ${userProgress.isCorrect})`,
    })
    .from(userProgress)
    .where(eq(userProgress.userId, userId))
    .groupBy(userProgress.lessonId, userProgress.lineIndex)
    .having(sql`count(*) filter (where not ${userProgress.isCorrect}) >= 2`)
    .orderBy(sql`count(*) filter (where not ${userProgress.isCorrect}) desc`)
    .limit(5);

  const total = Number(totals?.total ?? 0);
  return {
    totalAttempts: total,
    accuracy: total > 0 ? Number(totals.correct) / total : null,
    strugglingLines: struggling.map((s) => ({
      lessonId: s.lessonId,
      lineIndex: s.lineIndex,
      failCount: Number(s.failCount),
    })),
  };
}
