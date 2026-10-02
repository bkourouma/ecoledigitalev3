import { requirePermission } from "@/platform/auth/server";
import { DirectionDashboardScreen } from "./_components/Dashboard";

export default async function DirectionPage() {
  await requirePermission("analytics.read");
  return <DirectionDashboardScreen />;
}
