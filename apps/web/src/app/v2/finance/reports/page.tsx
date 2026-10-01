import { requirePermission } from "@/platform/auth/server";
import { ReportsScreen } from "../_components/Reports";

export default async function ReportsPage() {
  await requirePermission("finance.report.read");
  return <ReportsScreen />;
}
