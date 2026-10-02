import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PERM } from "../../_components/permissions";
import { ReportsScreen } from "../../_components/ReportsScreen";

export default async function StateassignReportsPage() {
  await requireAnyPermission(PERM.read, PERM.export);
  return <ReportsScreen />;
}
