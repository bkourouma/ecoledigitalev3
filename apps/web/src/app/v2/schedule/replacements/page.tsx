import { requirePermission } from "@/platform/auth/server";
import { ReplacementsScreen } from "../_components/ReplacementsScreen";

export default async function ReplacementsPage() {
  await requirePermission("schedule.manage");
  return <ReplacementsScreen />;
}
