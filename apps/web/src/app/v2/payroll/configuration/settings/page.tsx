import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../../_components/Configuration";

export default async function SettingsPage() {
  await requirePermission("payroll.settings.manage");
  return <SettingsScreen />;
}
