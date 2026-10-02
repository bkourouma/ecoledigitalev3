import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ExportScreen } from "../_components/ExportScreen";

export default async function ExportPage() {
  await requireAnyPermission("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read");
  return <ExportScreen />;
}
