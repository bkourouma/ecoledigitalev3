import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function CouncilsSettingsPage() {
  await requirePermission("council.settings.manage");
  return <SettingsScreen />;
}
