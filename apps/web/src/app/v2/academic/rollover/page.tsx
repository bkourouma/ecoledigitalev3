import { requirePermission } from "@/platform/auth/server";
import { RolloverGate } from "../_components/rollover/RolloverGate";
import { RolloverWizard } from "../_components/rollover/RolloverWizard";

export default async function RolloverPage() {
  await requirePermission("academic.year.rollover");
  return (
    <RolloverGate>
      <RolloverWizard />
    </RolloverGate>
  );
}
