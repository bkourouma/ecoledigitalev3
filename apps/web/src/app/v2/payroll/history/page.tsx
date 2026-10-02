import { requirePermission } from "@/platform/auth/server";
import { HistoryScreen } from "../_components/PayrollReports";

export default async function HistoryPage() {
  await requirePermission("payroll.payslip.read");
  return <HistoryScreen />;
}
