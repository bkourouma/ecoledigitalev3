import { requirePermission } from "@/platform/auth/server";
import { MinutesScreen } from "../../_components/MinutesScreen";

export default async function CouncilMinutesPage({ params }: { params: Promise<{ councilId: string }> }) {
  await requirePermission("council.minutes.read");
  const { councilId } = await params;
  return <MinutesScreen councilId={councilId} />;
}
