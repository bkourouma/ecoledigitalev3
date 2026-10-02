import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { TeacherClassDetail } from "../../_components/TeacherClasses";

export default async function TeacherClassPage({ params }: { params: Promise<{ classroomId: string }> }) {
  await requireAnyPermission("student.class.read", "staff.own.read");
  const { classroomId } = await params;
  if (!isUuid(classroomId)) notFound();
  return <TeacherClassDetail classroomId={classroomId} />;
}
