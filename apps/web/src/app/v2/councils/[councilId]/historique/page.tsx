import { requirePermission } from "@/platform/auth/server";
import { HistoryScreen } from "../../_components/HistoryScreen";

export default async function CouncilHistoryPage({ params }: { params: Promise<{ councilId: string }> }) {
  await requirePermission("council.read");
  const { councilId } = await params;
  return <HistoryScreen councilId={councilId} />;
}
