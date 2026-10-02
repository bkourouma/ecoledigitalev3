import { requirePermission } from "@/platform/auth/server";
import { StudentItemScreen } from "../../../_components/StudentItemScreen";

export default async function CouncilStudentPage({ params }: { params: Promise<{ councilId: string; itemId: string }> }) {
  await requirePermission("council.read");
  const { councilId, itemId } = await params;
  return <StudentItemScreen councilId={councilId} itemId={itemId} />;
}
