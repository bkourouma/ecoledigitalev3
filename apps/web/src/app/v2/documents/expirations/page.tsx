import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ExpirationsScreen } from "../_components/ExpirationsScreen";
import { VIEW_PERMISSIONS } from "../_components/documents-utils";

export default async function DocumentExpirationsPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <ExpirationsScreen />;
}
