import { requireAnyPermission } from "@/platform/auth/any-permission";
import { PeriodScreen } from "./_components/PeriodScreen";

export default async function ResultsPeriodPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requireAnyPermission("result.read", "period.lock", "period.close");
  const { classroom, period } = await searchParams;
  return <PeriodScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
