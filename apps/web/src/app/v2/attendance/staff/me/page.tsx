import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StaffAttendanceScreen } from "../../_components/StaffAttendanceScreen";

export default async function MyStaffAttendancePage() {
  await requireAnyPermission("attendance.own.read", "attendance.own.record", "attendance.leave.request");
  return <StaffAttendanceScreen mode="own" />;
}
