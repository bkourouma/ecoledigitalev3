import { requirePermission } from "@/platform/auth/server";
import { AlertsScreen } from "../_components/AlertsScreen";

export default async function AlertsPage() {
  await requirePermission("attendance.read");
  return <AlertsScreen />;
}
