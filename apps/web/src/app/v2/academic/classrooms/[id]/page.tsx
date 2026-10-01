import { requirePermission } from "@/platform/auth/server";
import { ClassroomDetail } from "../../_components/ClassroomDetail";

export default async function ClassroomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("academic.classroom.read");
  const { id } = await params;
  return <ClassroomDetail id={id} />;
}
