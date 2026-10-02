import { requireAnyPermission } from "@/platform/auth/any-permission";
import { CandidatesScreen } from "../_components/CandidatesScreen";

export default async function ExaminationCandidatesPage() {
  await requireAnyPermission("exam.candidate.read", "exam.candidate.manage");
  return <CandidatesScreen />;
}
