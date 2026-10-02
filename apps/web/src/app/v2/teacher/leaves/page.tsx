import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StaffAttendanceScreen } from "../../attendance/_components/StaffAttendanceScreen";

/** Mes congés et ma présence (fonction `attendance.staff`) : demandes de congé, pointage personnel. */
export default async function TeacherLeavesPage() {
  await requireAnyPermission("attendance.own.read", "attendance.own.record", "attendance.leave.request");
  return <StaffAttendanceScreen mode="own" />;
}
