import { decrypt } from "@/lib/crypto";
import { getSettings } from "@/lib/db/queries";
import { DEFAULT_VOICE } from "@/lib/realtime/voices";

export type SettingsStatus = {
  voice: string;
  model: string;
  hasOwnKey: boolean;
  keyHint: string | null;
  serverHasKey: boolean;
  dbError: boolean;
};

/** Server-side settings snapshot shared by the settings page and API responses. */
export async function getSettingsStatus(userId: string): Promise<SettingsStatus> {
  let voice: string = DEFAULT_VOICE;
  let model = process.env.REALTIME_MODEL ?? "gpt-realtime-2";
  let keyHint: string | null = null;
  let dbError = false;
  try {
    const row = await getSettings(userId);
    if (row?.voice) voice = row.voice;
    if (row?.realtimeModel) model = row.realtimeModel;
    if (row?.openaiApiKeyEnc) {
      try {
        keyHint = decrypt(row.openaiApiKeyEnc).slice(-4);
      } catch {
        keyHint = null; // APP_SECRET changed — treat as not set
      }
    }
  } catch {
    dbError = true;
  }
  return {
    voice,
    model,
    hasOwnKey: keyHint !== null,
    keyHint,
    serverHasKey: Boolean(process.env.OPENAI_API_KEY),
    dbError,
  };
}
