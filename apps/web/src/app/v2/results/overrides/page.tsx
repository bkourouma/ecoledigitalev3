import { requireAnyPermission } from "@/platform/auth/any-permission";
import { OverridesScreen } from "../_components/OverridesScreen";

export default async function ResultsOverridesPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requireAnyPermission("result.override.request", "result.override.approve");
  const { classroom, period } = await searchParams;
  return <OverridesScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
