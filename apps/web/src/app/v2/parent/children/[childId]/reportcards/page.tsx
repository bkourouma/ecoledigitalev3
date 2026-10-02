import { requirePermission } from "@/platform/auth/server";
import { ChildReportCards } from "../../../_components/ChildScreens";

export default async function ChildReportCardsPage({ params }: { params: Promise<{ childId: string }> }) {
  await requirePermission("reportcard.child.read");
  const { childId } = await params;
  return <ChildReportCards childId={childId} />;
}
