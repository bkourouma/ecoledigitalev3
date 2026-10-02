import { requirePermission } from "@/platform/auth/server";
import { PayslipsScreen } from "../_components/Payslips";

export default async function PayslipsPage() {
  await requirePermission("payroll.payslip.read");
  return <PayslipsScreen />;
}
