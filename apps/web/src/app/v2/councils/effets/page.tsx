import { requirePermission } from "@/platform/auth/server";
import { EffectsScreen } from "../_components/EffectsScreen";

export default async function CouncilsEffectsPage({ searchParams }: { searchParams: Promise<{ councilId?: string }> }) {
  await requirePermission("council.effect.manage");
  const { councilId } = await searchParams;
  return <EffectsScreen councilId={typeof councilId === "string" ? councilId : undefined} />;
}
