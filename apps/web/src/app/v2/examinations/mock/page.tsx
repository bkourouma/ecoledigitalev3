import { requirePermission } from "@/platform/auth/server";
import { MockScreen } from "../_components/MockScreen";

export default async function ExaminationMockPage() {
  await requirePermission("exam.mock.manage");
  return <MockScreen />;
}
