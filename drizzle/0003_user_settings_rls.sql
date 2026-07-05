ALTER TABLE "user_settings"
  ADD CONSTRAINT "user_settings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own settings" ON "user_settings"
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
