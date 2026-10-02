import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssessmentCreate } from "../_components/AssessmentCreate";

export default async function NewAssessmentPage({ searchParams }: { searchParams: Promise<{ classroom?: string }> }) {
  await requireAnyPermission("assessment.create", "assessment.manage");
  const { classroom } = await searchParams;
  return <AssessmentCreate initialClassroomId={classroom ?? ""} />;
}
