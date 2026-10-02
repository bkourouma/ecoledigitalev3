import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ExportsScreen } from "../_components/ExportsScreen";

export default async function ExaminationExportsPage() {
  await requireAnyPermission("exam.export.run", "exam.document.issue");
  return <ExportsScreen />;
}
