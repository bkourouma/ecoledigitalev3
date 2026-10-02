import { requirePermission } from "@/platform/auth/server";
import { PERM } from "../../_components/permissions";
import { SettingsScreen } from "../../_components/SettingsScreen";

export default async function StateassignSettingsPage() {
  await requirePermission(PERM.settingsManage);
  return <SettingsScreen />;
}
