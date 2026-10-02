import { requirePermission } from "@/platform/auth/server";
import { AdmissionsFunnelScreen } from "../_components/Funnel";

export default async function Page() {
  await requirePermission("analytics.admissions.read");
  return <AdmissionsFunnelScreen />;
}
