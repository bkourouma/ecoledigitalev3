import { requirePermission } from "@/platform/auth/server";
import { IndicatorsScreen } from "./_components/Indicators";

export default async function Page() {
  await requirePermission("analytics.read");
  return <IndicatorsScreen />;
}
