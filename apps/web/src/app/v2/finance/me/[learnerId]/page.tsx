import { notFound } from "next/navigation";
import { requireAnyPermission } from "@/platform/auth/any-permission";
import { isUuid } from "@/platform/portal/ids";
import { MyChildFinanceScreen } from "../../_components/MyFinance";

export default async function MyChildFinancePage({ params }: { params: Promise<{ learnerId: string }> }) {
  await requireAnyPermission("finance.child.read", "finance.self.read");
  const { learnerId } = await params;
  if (!isUuid(learnerId)) notFound();
  return <MyChildFinanceScreen learnerId={learnerId} />;
}
