import { requireAnyPermission } from "@/platform/auth/any-permission";
import { MyFinanceScreen } from "../_components/MyFinance";

export default async function MyFinancePage() {
  await requireAnyPermission("finance.child.read", "finance.self.read");
  return <MyFinanceScreen />;
}
