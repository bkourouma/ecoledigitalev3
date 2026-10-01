import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssessmentDetail } from "../_components/AssessmentDetail";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("assessment.read", "grade.read", "grade.enter");
  const { id } = await params;
  return <AssessmentDetail id={id} />;
}
