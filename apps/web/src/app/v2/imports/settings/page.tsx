import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/SettingsScreen";

export default async function ImportSettingsPage() {
  await requirePermission("imports.manage");
  return <SettingsScreen />;
}
