import { requirePermission } from "@/platform/auth/server";
import { ComplianceScreen } from "../_components/ComplianceScreen";

export default async function CompliancePage() {
  await requirePermission("attendance.report.read");
  return <ComplianceScreen />;
}
