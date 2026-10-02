import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function MessagingSettingsPage() {
  await requirePermission("messaging.settings.manage");
  return <SettingsScreen />;
}
