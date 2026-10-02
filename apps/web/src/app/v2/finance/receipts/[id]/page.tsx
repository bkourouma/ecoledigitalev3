import { requirePermission } from "@/platform/auth/server";
import { ReceiptDetailScreen } from "../../_components/Receipts";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.receipt.read");
  const { id } = await params;
  return <ReceiptDetailScreen id={id} />;
}
