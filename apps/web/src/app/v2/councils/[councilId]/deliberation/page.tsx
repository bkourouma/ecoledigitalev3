import { requirePermission } from "@/platform/auth/server";
import { DeliberationScreen } from "../../_components/DeliberationScreen";

export default async function CouncilDeliberationPage({ params }: { params: Promise<{ councilId: string }> }) {
  await requirePermission("council.read");
  const { councilId } = await params;
  return <DeliberationScreen councilId={councilId} />;
}
