import { requirePermission } from "@/platform/auth/server";
import { NewInvoiceScreen } from "../../_components/InvoiceForm";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance.invoice.create");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <NewInvoiceScreen initialLearnerId={one("learnerId")} />;
}
