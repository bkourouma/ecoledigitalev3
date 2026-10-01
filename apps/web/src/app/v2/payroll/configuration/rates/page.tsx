import { requirePermission } from "@/platform/auth/server";
import { RatesScreen } from "../../_components/Configuration";

export default async function RatesPage() {
  await requirePermission("payroll.rate.read");
  return <RatesScreen />;
}
