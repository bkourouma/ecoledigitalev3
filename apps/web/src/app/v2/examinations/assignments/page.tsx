import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssignmentsScreen } from "../_components/AssignmentsScreen";

export default async function ExaminationAssignmentsPage() {
  await requireAnyPermission("exam.center.manage", "exam.session.read");
  return <AssignmentsScreen />;
}
