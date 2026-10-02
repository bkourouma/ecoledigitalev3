import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TeacherAttendance } from "../_components/TeacherAttendance";

export default async function TeacherAttendancePage() {
  await requireAnyPermission("attendance.take", "attendance.manage");
  return <TeacherAttendance />;
}
