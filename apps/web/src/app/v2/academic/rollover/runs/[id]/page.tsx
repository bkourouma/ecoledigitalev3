import { requirePermission } from "@/platform/auth/server";
import { RolloverGate } from "../../../_components/rollover/RolloverGate";
import { RolloverRunView } from "../../../_components/rollover/RolloverRunView";

export default async function RolloverRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("academic.year.rollover");
  const { id } = await params;
  return (
    <RolloverGate>
      <RolloverRunView runId={id} />
    </RolloverGate>
  );
}
