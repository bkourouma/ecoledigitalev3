import { requirePermission } from "@/platform/auth/server";
import { TodayScreen } from "../_components/TodayScreen";

export default async function TodayPage() {
  await requirePermission("schedule.own.read");
  return <TodayScreen />;
}
