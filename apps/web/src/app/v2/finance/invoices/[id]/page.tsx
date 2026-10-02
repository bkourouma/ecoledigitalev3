import { requirePermission } from "@/platform/auth/server";
import { InvoiceDetailScreen } from "../../_components/Invoices";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("finance.invoice.read");
  const { id } = await params;
  return <InvoiceDetailScreen id={id} />;
}
