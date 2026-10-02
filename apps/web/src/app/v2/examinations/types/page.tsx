import { requirePermission } from "@/platform/auth/server";
import { TypesScreen } from "../_components/TypesScreen";

export default async function ExaminationTypesPage() {
  await requirePermission("exam.type.read");
  return <TypesScreen />;
}
