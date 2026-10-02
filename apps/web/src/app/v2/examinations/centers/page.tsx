import { requirePermission } from "@/platform/auth/server";
import { CentersScreen } from "../_components/CentersScreen";

export default async function ExaminationCentersPage() {
  await requirePermission("exam.center.manage");
  return <CentersScreen />;
}
