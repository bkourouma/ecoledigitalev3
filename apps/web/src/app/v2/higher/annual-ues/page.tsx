import { requirePermission } from "@/platform/auth/server";
import { AnnualUesScreen } from "../_components/AnnualUesScreen";

export default async function HigherAnnualUesPage() {
  // Lecture : `higher.diploma.read` ; déclaration et retrait : `higher.annual_ue.manage` (le serveur applique chaque droit).
  await requirePermission("higher.diploma.read");
  return <AnnualUesScreen />;
}
