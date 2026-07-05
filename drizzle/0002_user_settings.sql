CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"openai_api_key_enc" text,
	"voice" text DEFAULT 'marin' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
