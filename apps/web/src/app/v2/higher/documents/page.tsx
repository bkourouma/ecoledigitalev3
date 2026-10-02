import { requirePermission } from "@/platform/auth/server";
import { DocumentsScreen } from "../_components/DocumentsScreen";

export default async function HigherDocumentsPage() {
  await requirePermission("higher.document.read");
  return <DocumentsScreen />;
}
