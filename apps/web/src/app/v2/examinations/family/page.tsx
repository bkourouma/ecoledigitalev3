import { requireAnyPermission } from "@/platform/auth/any-permission";
import { FamilyScreen } from "../_components/FamilyScreen";

export default async function ExaminationFamilyPage() {
  // Élève : son examen ; parent : celui de ses enfants liés (le lien est revérifié par l'API à chaque appel).
  await requireAnyPermission("exam.document.child.read", "exam.document.self.read");
  return <FamilyScreen />;
}
