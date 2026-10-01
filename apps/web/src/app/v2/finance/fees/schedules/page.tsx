import { requirePermission } from "@/platform/auth/server";
import { SchedulesScreen } from "../../_components/Catalog";

export default async function Page() {
  await requirePermission("finance.fee.read");
  return <SchedulesScreen />;
}
