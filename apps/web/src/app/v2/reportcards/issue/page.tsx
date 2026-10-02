import { requirePermission } from "@/platform/auth/server";
import { IssueScreen } from "../_components/IssueScreen";

export default async function ReportcardsIssuePage({ searchParams }: { searchParams: Promise<{ classroom?: string; period?: string }> }) {
  await requirePermission("reportcard.generate");
  const { classroom, period } = await searchParams;
  return <IssueScreen initialClassroomId={classroom ?? ""} initialPeriodId={period ?? ""} />;
}
