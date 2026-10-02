import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssessmentsScreen } from "./_components/AssessmentsScreen";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ classroom?: string; status?: string }> }) {
  await requireAnyPermission("assessment.read", "grade.read", "grade.enter");
  const { classroom, status } = await searchParams;
  return <AssessmentsScreen initialClassroomId={classroom ?? ""} initialStatus={status ?? ""} />;
}
