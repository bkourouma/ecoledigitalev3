import { requirePermission } from "@/platform/auth/server";
import { PlansScreen } from "../../_components/Catalog";

export default async function Page() {
  await requirePermission("finance.fee.read");
  return <PlansScreen />;
}
