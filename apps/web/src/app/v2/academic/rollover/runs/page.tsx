import { requirePermission } from "@/platform/auth/server";
import { RolloverGate } from "../../_components/rollover/RolloverGate";
import { RolloverHistory } from "../../_components/rollover/RolloverHistory";

export default async function RolloverRunsPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requirePermission("academic.year.rollover");
  const { from } = await searchParams;
  return (
    <RolloverGate>
      <RolloverHistory initialFromId={from ?? ""} />
    </RolloverGate>
  );
}
