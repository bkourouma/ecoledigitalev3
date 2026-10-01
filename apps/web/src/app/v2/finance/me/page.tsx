import { requireAnyPermission } from "@/platform/auth/any-permission";
import { MyFinanceScreen } from "../_components/MyFinance";

export default async function MyFinancePage() {
  await requireAnyPermission("student.child.read", "student.self.read");
  return <MyFinanceScreen />;
}
