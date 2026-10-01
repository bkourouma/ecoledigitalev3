import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StudentDetail } from "../_components/StudentDetail";

export default async function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("student.read", "student.class.read");
  const { id } = await params;
  return <StudentDetail id={id} />;
}
