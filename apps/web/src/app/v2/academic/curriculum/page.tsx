import { requirePermission } from "@/platform/auth/server";
import { CurriculumScreen } from "../_components/CurriculumScreen";

export default async function CurriculumPage() {
  await requirePermission("curriculum.read");
  return <CurriculumScreen />;
}
