CREATE TABLE "learner_memory" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "learner_memory_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"observation" text NOT NULL,
	"source" text DEFAULT 'teacher' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_progress_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"line_index" integer NOT NULL,
	"user_response" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "learner_memory_user_category_idx" ON "learner_memory" USING btree ("user_id","category");--> statement-breakpoint
CREATE INDEX "user_progress_user_lesson_idx" ON "user_progress" USING btree ("user_id","lesson_id","line_index");