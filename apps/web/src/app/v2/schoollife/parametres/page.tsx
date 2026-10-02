import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function SchoolLifeSettingsPage() {
  await requirePermission("schoollife.settings.manage");
  return <SettingsScreen />;
}
