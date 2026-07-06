ALTER TABLE "user_settings" ADD COLUMN "lesson_mode" text DEFAULT 'natural' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "chunk_size" integer DEFAULT 20 NOT NULL;