import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function AdmissionsSettingsPage() {
  await requirePermission("admission.settings.manage");
  return <SettingsScreen />;
}
