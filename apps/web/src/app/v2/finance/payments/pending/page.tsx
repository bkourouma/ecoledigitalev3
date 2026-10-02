import { requirePermission } from "@/platform/auth/server";
import { PendingPaymentsScreen } from "../../_components/PendingPayments";

export default async function PendingPaymentsPage() {
  await requirePermission("finance.payment.read");
  return <PendingPaymentsScreen />;
}
