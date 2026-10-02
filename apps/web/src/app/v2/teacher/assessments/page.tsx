import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TeacherAssessments } from "../_components/TeacherAssessments";

export default async function TeacherAssessmentsPage({ searchParams }: { searchParams: Promise<{ classroom?: string }> }) {
  await requireAnyPermission("assessment.read", "grade.read", "grade.enter");
  const { classroom } = await searchParams;
  return <TeacherAssessments initialClassroomId={classroom ?? ""} />;
}
