import { requirePermission } from "@/platform/auth/server";
import { ExemptionsScreen } from "../_components/ExemptionsScreen";

export default async function HigherExemptionsPage() {
  // Lecture : `higher.exemption.read` ; octroi et révocation : `higher.exemption.grant` (le serveur applique chaque droit).
  await requirePermission("higher.exemption.read");
  return <ExemptionsScreen />;
}
