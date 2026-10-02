import { requirePermission } from "@/platform/auth/server";
import { PaymentDetailScreen } from "../../_components/Payments";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.payment.read");
  const { id } = await params;
  return <PaymentDetailScreen id={id} />;
}
