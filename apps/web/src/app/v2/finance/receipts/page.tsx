import { requirePermission } from "@/platform/auth/server";
import { ReceiptsScreen } from "../_components/Receipts";

export default async function ReceiptsPage() {
  await requirePermission("finance.receipt.read");
  return <ReceiptsScreen />;
}
