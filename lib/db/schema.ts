import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// user_id references auth.users(id); the FK lives in the SQL migration
// (drizzle doesn't manage Supabase's auth schema).

export const userProgress = pgTable(
  "user_progress",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    lineIndex: integer("line_index").notNull(),
    userResponse: text("user_response").notNull(),
    isCorrect: boolean("is_correct").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("user_progress_user_lesson_idx").on(t.userId, t.lessonId, t.lineIndex)],
);

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id").primaryKey(),
  /** AES-256-GCM encrypted, base64(iv | tag | ciphertext); null = use server key */
  openaiApiKeyEnc: text("openai_api_key_enc"),
  voice: text("voice").notNull().default("marin"),
  /** realtime model id; null = server default */
  realtimeModel: text("realtime_model"),
  /** natural (chunked, conversational) | lines (precise line-by-line) */
  lessonMode: text("lesson_mode").notNull().default("natural"),
  chunkSize: integer("chunk_size").notNull().default(20),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// relative import — drizzle-kit loads this file outside Next's alias resolution
import type { MemoryCategory } from "../memory/categories";
export { MEMORY_CATEGORIES, type MemoryCategory } from "../memory/categories";

export const usageLog = pgTable(
  "usage_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").notNull(),
    mode: text("mode").notNull(), // lesson | practice | guide
    usd: doublePrecision("usd").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    seconds: integer("seconds").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_log_user_idx").on(t.userId, t.createdAt)],
);

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("practice_sessions_user_idx").on(t.userId, t.createdAt)],
);

export const learnerMemory = pgTable(
  "learner_memory",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    userId: uuid("user_id").notNull(),
    category: text("category").$type<MemoryCategory>().notNull(),
    observation: text("observation").notNull(),
    source: text("source").notNull().default("teacher"), // teacher | derived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("learner_memory_user_category_idx").on(t.userId, t.category)],
);
