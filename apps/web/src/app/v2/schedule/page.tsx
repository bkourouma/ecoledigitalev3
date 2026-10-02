import { requireAnyPermission } from "@/platform/auth/any-permission";
import { TimetableScreen } from "./_components/TimetableScreen";

export default async function SchedulePage() {
  await requireAnyPermission("schedule.read", "schedule.own.read", "schedule.self.read", "schedule.child.read");
  return <TimetableScreen />;
}
