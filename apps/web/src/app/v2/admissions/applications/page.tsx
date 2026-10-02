import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ApplicationsListScreen } from "../_components/ApplicationsListScreen";
import { VIEW_PERMISSIONS } from "../_components/admissions-utils";

export default async function AdmissionsApplicationsPage() {
  await requireAnyPermission(...VIEW_PERMISSIONS);
  return <ApplicationsListScreen />;
}
