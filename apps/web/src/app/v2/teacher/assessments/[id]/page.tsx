import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { AssessmentDetail } from "../../../assessments/_components/AssessmentDetail";

export default async function TeacherAssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("assessment.read", "grade.read");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AssessmentDetail id={id} />;
}
