import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { GradeEntryScreen } from "../../../../assessments/_components/GradeEntry";

/** Grille de notes de l'évaluation (saisie en lot, hors ligne tolérante) : l'API vérifie l'affectation de l'enseignant à la classe et à la matière. */
export default async function TeacherGradeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("grade.read", "grade.enter");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <GradeEntryScreen assessmentId={id} detailHref={`/v2/teacher/assessments/${id}`} />;
}
