import { requireAnyPermission } from "@/platform/auth/any-permission";
import { CorrectionsScreen } from "../_components/CorrectionsScreen";

export default async function ExaminationCorrectionsPage() {
  await requireAnyPermission("exam.result.read", "exam.result.revise");
  return <CorrectionsScreen />;
}
