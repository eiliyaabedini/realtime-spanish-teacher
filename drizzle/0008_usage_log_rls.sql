ALTER TABLE "usage_log"
  ADD CONSTRAINT "usage_log_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "usage_log" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own usage" ON "usage_log"
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
