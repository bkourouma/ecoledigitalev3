import { requireAnyPermission } from "@/platform/auth/any-permission";
import { ResultsScreen } from "../_components/ResultsScreen";

export default async function ExaminationResultsPage() {
  await requireAnyPermission("exam.result.read", "exam.result.enter", "exam.score.enter");
  return <ResultsScreen />;
}
