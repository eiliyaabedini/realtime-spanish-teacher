import { Header } from "@/components/Header";
import { getSettingsStatus } from "@/lib/settings";
import { getUser } from "@/lib/supabase/server";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  const status = user
    ? await getSettingsStatus(user.id)
    : { voice: "marin", hasOwnKey: false, keyHint: null, serverHasKey: false, dbError: true };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Header />
      <h1 className="text-2xl font-semibold">Settings</h1>
      <SettingsForm initial={status} />
    </div>
  );
}
