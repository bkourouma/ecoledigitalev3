import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StudentDocuments } from "../_components/StudentScreens";

export default async function StudentDocumentsPage() {
  await requireAnyPermission("reportcard.self.read", "finance.self.read", "higher.self.read");
  return <StudentDocuments />;
}
