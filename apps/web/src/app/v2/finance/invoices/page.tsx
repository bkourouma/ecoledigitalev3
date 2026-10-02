import { requirePermission } from "@/platform/auth/server";
import { InvoicesScreen } from "../_components/Invoices";

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("finance.invoice.read");
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <InvoicesScreen initial={{ learnerId: one("learnerId"), status: one("status"), groupKey: one("groupKey"), academicYear: one("academicYear") }} />;
}
