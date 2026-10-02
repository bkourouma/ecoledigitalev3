import { requirePermission } from "@/platform/auth/server";
import { MyPayslipsScreen } from "../_components/PayrollReports";

export default async function MyPayslipsPage() {
  await requirePermission("payroll.payslip.read_own");
  return <MyPayslipsScreen />;
}
