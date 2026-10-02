import { requirePermission } from "@/platform/auth/server";
import { ImportsScreen } from "../_components/ImportsScreen";

export default async function ExaminationImportsPage() {
  await requirePermission("exam.import.manage");
  return <ImportsScreen />;
}
