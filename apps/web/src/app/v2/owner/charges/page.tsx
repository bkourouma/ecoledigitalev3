import { requirePermission } from "@/platform/auth/server";
import { ChargesScreen } from "../_components/PayrollCharges";

export default async function OwnerChargesPage() {
  await requirePermission("analytics.charges.read");
  return <ChargesScreen />;
}
