import { requireAnyPermission } from "@/platform/auth/any-permission";
import { CandidateDetailScreen } from "../../_components/CandidateDetailScreen";

export default async function ExaminationCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyPermission("exam.candidate.read", "exam.candidate.manage");
  const { id } = await params;
  return <CandidateDetailScreen id={id} />;
}
