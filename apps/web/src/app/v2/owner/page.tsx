import { requirePermission } from "@/platform/auth/server";
import { FreshnessScreen } from "./_components/PayrollCharges";

export default async function OwnerHomePage() {
  await requirePermission("analytics.read");
  return <FreshnessScreen />;
}
