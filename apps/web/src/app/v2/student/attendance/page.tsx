import { requirePermission } from "@/platform/auth/server";
import { StudentAttendance } from "../_components/StudentScreens";

export default async function StudentAttendancePage() {
  await requirePermission("attendance.self.read");
  return <StudentAttendance />;
}
