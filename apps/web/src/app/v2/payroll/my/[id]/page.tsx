import { requirePermission } from "@/platform/auth/server";
import { MyPayslipScreen } from "../../_components/PayrollReports";

export default async function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll.payslip.read_own");
  const { id } = await params;
  return <MyPayslipScreen id={id} />;
}
