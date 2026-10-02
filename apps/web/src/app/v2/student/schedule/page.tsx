import { requirePermission } from "@/platform/auth/server";
import { StudentSchedule } from "../_components/StudentScreens";

export default async function StudentSchedulePage() {
  await requirePermission("schedule.self.read");
  return <StudentSchedule />;
}
