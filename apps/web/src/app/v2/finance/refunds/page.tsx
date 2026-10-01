import { requirePermission } from "@/platform/auth/server";
import { RefundsScreen } from "../_components/Refunds";

export default async function RefundsPage() {
  await requirePermission("finance.payment.read");
  return <RefundsScreen />;
}
