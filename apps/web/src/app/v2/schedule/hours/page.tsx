import { requirePermission } from "@/platform/auth/server";
import { HoursScreen } from "../_components/HoursScreen";

export default async function HoursPage() {
  await requirePermission("schedule.manage");
  return <HoursScreen />;
}
