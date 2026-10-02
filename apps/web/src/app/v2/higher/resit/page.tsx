import { requirePermission } from "@/platform/auth/server";
import { ResitScreen } from "../_components/ResitScreen";

export default async function HigherResitPage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requirePermission("higher.resit.manage");
  const { classroom, period } = await searchParams;
  return <ResitScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
