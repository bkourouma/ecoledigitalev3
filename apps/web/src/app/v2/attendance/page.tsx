import { requirePermission } from "@/platform/auth/server";
import { DashboardScreen } from "./_components/DashboardScreen";

export default async function AttendanceDashboardPage() {
  await requirePermission("attendance.read");
  return <DashboardScreen />;
}
