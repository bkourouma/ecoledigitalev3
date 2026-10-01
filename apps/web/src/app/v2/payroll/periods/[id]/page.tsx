import { requirePermission } from "@/platform/auth/server";
import { PeriodDetailScreen } from "../../_components/Periods";

export default async function PeriodPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("payroll.period.manage");
  const { id } = await params;
  return <PeriodDetailScreen id={id} />;
}
