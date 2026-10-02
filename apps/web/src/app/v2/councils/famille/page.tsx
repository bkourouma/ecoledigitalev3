import { requirePermission } from "@/platform/auth/server";
import { PortalScreen } from "../_components/PortalScreen";

export default async function CouncilsFamilyPage() {
  await requirePermission("council.child.read");
  return <PortalScreen mode="guardian" />;
}
