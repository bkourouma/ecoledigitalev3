import { requirePermission } from "@/platform/auth/server";
import { QuarantineScreen } from "../_components/QuarantineScreen";

export default async function DocumentQuarantinePage() {
  await requirePermission("documents.quarantine.manage");
  return <QuarantineScreen />;
}
