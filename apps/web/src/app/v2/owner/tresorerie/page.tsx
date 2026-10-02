import { requirePermission } from "@/platform/auth/server";
import { TreasuryScreen } from "../_components/Finance";

export default async function OwnerTreasuryPage() {
  await requirePermission("analytics.treasury.read");
  return <TreasuryScreen />;
}
