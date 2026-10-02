import { requirePermission } from "@/platform/auth/server";
import { OwnerScreen } from "../_components/PayrollReports";

export default async function OwnerPage() {
  await requirePermission("payroll.report.read");
  return <OwnerScreen />;
}
