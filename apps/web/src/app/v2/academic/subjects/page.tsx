import { requirePermission } from "@/platform/auth/server";
import { SubjectsScreen } from "../_components/SubjectsScreen";

export default async function SubjectsPage() {
  await requirePermission("curriculum.read");
  return <SubjectsScreen />;
}
