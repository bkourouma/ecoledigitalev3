import { requireAnyPermission } from "@/platform/auth/any-permission";
import { FamilyScreen } from "../_components/FamilyScreen";

export default async function FamilyReportcardsPage() {
  // Élève : ses bulletins publiés ; parent : ceux de ses enfants liés (le lien est revérifié par l'API à chaque appel).
  await requireAnyPermission("reportcard.self.read", "reportcard.child.read");
  return <FamilyScreen />;
}
