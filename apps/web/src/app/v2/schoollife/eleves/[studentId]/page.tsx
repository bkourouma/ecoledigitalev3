import { requirePermission } from "@/platform/auth/server";
import { StudentFileScreen } from "../../_components/StudentFileScreen";

export default async function SchoolLifeStudentPage({ params }: { params: Promise<{ studentId: string }> }) {
  await requirePermission("schoollife.read");
  const { studentId } = await params;
  return <StudentFileScreen studentId={studentId} />;
}
