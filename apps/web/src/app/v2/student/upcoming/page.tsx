import { requirePermission } from "@/platform/auth/server";
import { StudentUpcoming } from "../_components/StudentScreens";

export default async function StudentUpcomingPage() {
  await requirePermission("schedule.self.read");
  return <StudentUpcoming />;
}
