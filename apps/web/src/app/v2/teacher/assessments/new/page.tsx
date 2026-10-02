import { requirePermission } from "@/platform/auth/server";
import { AssessmentCreate } from "../../../assessments/_components/AssessmentCreate";

/** Création d'une évaluation : les classes, matières et périodes proposées sont celles de « mes classes » (sans lecture académique). */
export default async function TeacherAssessmentNewPage({ searchParams }: { searchParams: Promise<{ classroom?: string }> }) {
  await requirePermission("assessment.create");
  const { classroom } = await searchParams;
  return <AssessmentCreate initialClassroomId={classroom ?? ""} basePath="/v2/teacher/assessments" />;
}
