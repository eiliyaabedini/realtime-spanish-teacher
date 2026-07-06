ALTER TABLE "practice_sessions"
  ADD CONSTRAINT "practice_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "practice_sessions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own practice sessions" ON "practice_sessions"
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
