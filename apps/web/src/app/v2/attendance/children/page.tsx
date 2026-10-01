import { requirePermission } from "@/platform/auth/server";
import { ChildrenAttendanceList } from "../_components/PortalScreen";

export default async function ChildrenAttendancePage() {
  await requirePermission("attendance.child.read");
  return <ChildrenAttendanceList />;
}
