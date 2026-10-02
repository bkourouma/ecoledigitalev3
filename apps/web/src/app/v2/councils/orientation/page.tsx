import { requirePermission } from "@/platform/auth/server";
import { OrientationScreen } from "../_components/OrientationScreen";

export default async function CouncilsOrientationPage() {
  await requirePermission("council.orientation.read");
  return <OrientationScreen />;
}
