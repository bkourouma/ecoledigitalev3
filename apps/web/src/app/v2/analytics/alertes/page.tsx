import { requirePermission } from "@/platform/auth/server";
import { AlertsScreen } from "../_components/Alerts";

export default async function Page() {
  await requirePermission("analytics.alerts.read");
  return <AlertsScreen />;
}
