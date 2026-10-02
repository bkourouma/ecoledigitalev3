import { requirePermission } from "@/platform/auth/server";
import { MatrixScreen } from "../_components/MatrixScreen";

export default async function ResultsMatrixPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requirePermission("result.read");
  const { classroom, period } = await searchParams;
  return <MatrixScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
