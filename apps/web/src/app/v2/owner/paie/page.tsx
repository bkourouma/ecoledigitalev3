import { requirePermission } from "@/platform/auth/server";
import { PayrollMassScreen } from "../_components/PayrollCharges";

export default async function OwnerPayrollPage() {
  await requirePermission("analytics.payroll.read");
  return <PayrollMassScreen />;
}
