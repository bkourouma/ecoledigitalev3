import { requireAnyPermission } from "@/platform/auth/any-permission";
import { FinanceOverviewScreen } from "./_components/Reports";

export default async function FinancePage() {
  await requireAnyPermission("finance.report.read", "finance.invoice.read", "finance.payment.read", "finance.cashregister.open", "finance.fee.read");
  return <FinanceOverviewScreen />;
}
