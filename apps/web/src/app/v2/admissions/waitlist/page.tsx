import { requirePermission } from "@/platform/auth/server";
import { WaitlistScreen } from "../_components/WaitlistScreen";

export default async function AdmissionsWaitlistPage() {
  await requirePermission("admission.waitlist.manage");
  return <WaitlistScreen />;
}
