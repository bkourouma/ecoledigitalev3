import { requirePermission } from "@/platform/auth/server";
import { CardsScreen } from "./_components/CardsScreen";

export default async function ReportcardsPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requirePermission("reportcard.read");
  const { classroom, period } = await searchParams;
  return <CardsScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
