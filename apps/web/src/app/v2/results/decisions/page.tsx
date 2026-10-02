import { requireAnyPermission } from "@/platform/auth/any-permission";
import { DecisionsScreen } from "../_components/DecisionsScreen";

export default async function ResultsDecisionsPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requireAnyPermission("decision.record", "decision.approve", "appreciation.write");
  const { classroom, period } = await searchParams;
  return <DecisionsScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
