import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function DocumentSettingsPage() {
  await requirePermission("documents.settings.manage");
  return <SettingsScreen />;
}
