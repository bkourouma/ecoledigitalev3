import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/server";
import { isUuid } from "@/platform/portal/ids";
import { TeacherPayslip } from "../../_components/TeacherPayslips";

export default async function TeacherPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll.payslip.read_own");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <TeacherPayslip id={id} />;
}
