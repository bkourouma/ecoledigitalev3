import { requireAnyPermission } from "@/platform/auth/any-permission";
import { MyChildFinanceScreen } from "../../_components/MyFinance";

export default async function MyChildFinancePage({ params }: { params: Promise<{ learnerId: string }> }) {
  await requireAnyPermission("student.child.read", "student.self.read");
  const { learnerId } = await params;
  return <MyChildFinanceScreen learnerId={learnerId} />;
}
