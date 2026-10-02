import { requireAnyPermission } from "@/platform/auth/any-permission";
import { MyDocumentsScreen } from "../../_components/MyDocumentsScreen";

export default async function MyHigherDocumentsPage() {
  // Étudiant : `higher.self.read` ; tuteur : `higher.child.read` (le serveur ne renvoie que les documents publiés de ses enfants).
  await requireAnyPermission("higher.self.read", "higher.child.read");
  return <MyDocumentsScreen />;
}
