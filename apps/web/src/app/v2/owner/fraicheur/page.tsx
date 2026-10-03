import { requirePermission } from "@/platform/auth/server";
import { FreshnessScreen } from "../_components/PayrollCharges";

/** Fraîcheur des données de pilotage (écran technique : sources, dernier calcul, manques). */
export default async function OwnerFreshnessPage() {
  await requirePermission("analytics.read");
  return <FreshnessScreen />;
}
