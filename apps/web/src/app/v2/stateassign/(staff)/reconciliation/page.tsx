import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PERM } from "../../_components/permissions";
import { ReconciliationScreen } from "../../_components/ReconciliationScreen";

export default async function StateassignReconciliationPage() {
  await requireAnyPermission(PERM.reconcile, PERM.read);
  return <ReconciliationScreen />;
}
