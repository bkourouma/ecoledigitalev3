import { requirePermission } from "@/platform/auth/server";
import { ResitScreen } from "../../higher/_components/ResitScreen";

/** Candidats au rattrapage depuis les résultats : même écran que `/v2/higher/resit` (les candidats sont désignés par `results`). */
export default async function ResultsResitPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requirePermission("higher.resit.manage");
  const { classroom, period } = await searchParams;
  return <ResitScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
