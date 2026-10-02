import { requireAnyPermission } from "@/platform/auth/any-permission";
import { GradeEntryScreen } from "../../_components/GradeEntry";

export default async function GradeEntryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("grade.read", "grade.enter");
  const { id } = await params;
  return <GradeEntryScreen assessmentId={id} />;
}
