import { requirePermission } from "@/platform/auth/server";
import { StaffAttendanceScreen } from "../_components/StaffAttendanceScreen";

export default async function StaffAttendancePage() {
  await requirePermission("attendance.staff.read");
  return <StaffAttendanceScreen mode="manage" />;
}
