import { requirePermission } from "@/platform/auth/server";
import { PortalScreen } from "../../_components/PortalScreen";

export default async function ChildAttendancePage({ params }: { params: Promise<{ studentId: string }> }) {
  await requirePermission("attendance.child.read");
  const { studentId } = await params;
  return <PortalScreen via="child" studentId={studentId} />;
}
