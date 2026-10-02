import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PrerequisitesScreen } from "../_components/PrerequisitesScreen";

export default async function HigherPrerequisitesPage() {
  // Lecture : `higher.credits.read` ; édition : `higher.prerequisite.manage` (le serveur applique chaque droit).
  await requireAnyPermission("higher.prerequisite.manage", "higher.credits.read");
  return <PrerequisitesScreen />;
}
