import { requirePermission } from "@/platform/auth/server";
import { PortalScreen } from "../_components/PortalScreen";

export default async function CouncilsMePage() {
  await requirePermission("council.self.read");
  return <PortalScreen mode="student" />;
}
