import {
  bigint,
  boolean,
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const MEMORY_CATEGORIES = ["grammar", "vocab", "pronunciation", "pace", "style"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

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
