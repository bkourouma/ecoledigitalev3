import { requirePermission } from "@/platform/auth/server";
import { PaymentsScreen } from "../_components/Payments";

export default async function PaymentsPage() {
  await requirePermission("finance.payment.read");
  return <PaymentsScreen />;
}
