import { requirePermission } from "@/platform/auth/server";
import { StudentAttendanceScreen } from "../../_components/StudentAttendanceScreen";

export default async function StudentAttendancePage({ params, searchParams }: { params: Promise<{ studentId: string }>; searchParams: Promise<{ periodId?: string }> }) {
  await requirePermission("attendance.read");
  const { studentId } = await params;
  const { periodId } = await searchParams;
  return <StudentAttendanceScreen studentId={studentId} initialPeriodId={periodId} />;
}
