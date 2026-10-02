import { requirePermission } from "@/platform/auth/server";
import { SettingsScreen } from "../_components/settings/SettingsScreen";
import { isSettingsTab } from "../_components/settings/settings-tabs";

export default async function AcademicSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePermission("academic.read");
  const { tab } = await searchParams;
  return <SettingsScreen initialTab={isSettingsTab(tab) ? tab : "periods"} />;
}
