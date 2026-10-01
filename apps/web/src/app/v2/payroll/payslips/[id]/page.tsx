import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PayslipDetailScreen } from "../../_components/Payslips";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("payroll.payslip.read", "payroll.payslip.read_own");
  const { id } = await params;
  return <PayslipDetailScreen id={id} />;
}
