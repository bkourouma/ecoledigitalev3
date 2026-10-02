import { requirePermission } from "@/platform/auth/server";
import { DashboardScreen } from "./_components/DashboardScreen";

export default async function SchoolLifeDashboardPage() {
  await requirePermission("schoollife.read.all");
  return <DashboardScreen />;
}
