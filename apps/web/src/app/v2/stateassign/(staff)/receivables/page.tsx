import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PERM } from "../../_components/permissions";
import { ReceivablesScreen } from "../../_components/ReceivablesScreen";

export default async function StateassignReceivablesPage() {
  await requireAnyPermission(PERM.read, PERM.receivableManage);
  return <ReceivablesScreen />;
}
