import { requirePermission } from "@/platform/auth/server";
import { ChildAttendance } from "../../../_components/ChildScreens";

export default async function ChildAttendancePage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("attendance.child.read");
  const { childId } = await params;
  return <ChildAttendance childId={childId} />;
}
