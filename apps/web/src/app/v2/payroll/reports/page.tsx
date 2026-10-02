import { requirePermission } from "@/platform/auth/server";
import { PayrollReportsScreen } from "../_components/PayrollReports";

export default async function PayrollReportsPage() {
  await requirePermission("payroll.report.read");
  return <PayrollReportsScreen />;
}
