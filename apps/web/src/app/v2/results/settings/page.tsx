import { requireAnyPermission } from "@/platform/auth/any-permission";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function ResultsSettingsPage() {
  await requireAnyPermission("result.settings.manage");
  return <SettingsScreen />;
}
