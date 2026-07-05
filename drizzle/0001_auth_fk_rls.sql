-- Supabase specifics drizzle doesn't manage: FKs into auth.users and RLS.
-- RLS is defense-in-depth here — the app connects as the postgres role and
-- scopes every query by user id in code (lib/db/queries.ts).

ALTER TABLE "user_progress"
  ADD CONSTRAINT "user_progress_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "learner_memory"
  ADD CONSTRAINT "learner_memory_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "user_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learner_memory" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own progress" ON "user_progress"
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own memory" ON "learner_memory"
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
