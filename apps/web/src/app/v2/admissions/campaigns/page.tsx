import { requireAnyPermission } from "@/platform/auth/any-permission";
import { CampaignsScreen } from "../_components/CampaignsScreen";

export default async function AdmissionsCampaignsPage() {
  await requireAnyPermission("admission.campaign.manage", "admission.read");
  return <CampaignsScreen />;
}
