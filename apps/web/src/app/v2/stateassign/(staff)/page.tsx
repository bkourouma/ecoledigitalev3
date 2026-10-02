import { requireAnyPermission } from "@/platform/auth/any-permission";
import { AssignmentsScreen } from "../_components/AssignmentsScreen";
import { VIEW_PERMISSIONS } from "../_components/permissions";

export default async function StateassignPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <AssignmentsScreen />;
}
