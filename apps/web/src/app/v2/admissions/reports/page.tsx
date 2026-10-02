import { requirePermission } from "@/platform/auth/server";
import { ReportsScreen } from "../_components/ReportsScreen";

export default async function AdmissionsReportsPage() {
  await requirePermission("admission.report.read");
  return <ReportsScreen />;
}
