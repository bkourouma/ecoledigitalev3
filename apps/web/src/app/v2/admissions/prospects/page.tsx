import { requirePermission } from "@/platform/auth/server";
import { ProspectsScreen } from "../_components/ProspectsScreen";

export default async function AdmissionsProspectsPage() {
  await requirePermission("admission.prospect.manage");
  return <ProspectsScreen />;
}
