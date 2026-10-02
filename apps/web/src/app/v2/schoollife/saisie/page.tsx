import { requirePermission } from "@/platform/auth/server";
import { QuickEntryScreen } from "../_components/QuickEntryScreen";

export default async function SchoolLifeQuickEntryPage() {
  await requirePermission("schoollife.read");
  return <QuickEntryScreen />;
}
