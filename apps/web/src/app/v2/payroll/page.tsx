import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PeriodsScreen } from "./_components/Periods";

export default async function PayrollPage() {
  await requireAnyPermission("payroll.period.manage", "payroll.payslip.read");
  return <PeriodsScreen />;
}
