import { requirePermission } from "@/platform/auth/server";
import { StatisticsScreen } from "../_components/StatisticsScreen";

export default async function ExaminationStatisticsPage() {
  await requirePermission("exam.statistics.read");
  return <StatisticsScreen />;
}
