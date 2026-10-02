import { requirePermission } from "@/platform/auth/server";
import { CouncilFileScreen } from "../_components/CouncilFileScreen";

export default async function CouncilFilePage({ params }: { params: Promise<{ councilId: string }> }) {
  await requirePermission("council.read");
  const { councilId } = await params;
  return <CouncilFileScreen councilId={councilId} />;
}
