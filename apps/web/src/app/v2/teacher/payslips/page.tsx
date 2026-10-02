import { requirePermission } from "@/platform/auth/server";
import { TeacherPayslips } from "../_components/TeacherPayslips";

export default async function TeacherPayslipsPage() {
  await requirePermission("payroll.payslip.read_own");
  return <TeacherPayslips />;
}
