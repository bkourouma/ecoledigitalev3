import { requirePermission } from "@/platform/auth/server";
import { TeacherToday } from "./_components/TeacherToday";

export default async function TeacherTodayPage() {
  await requirePermission("schedule.own.read");
  return <TeacherToday />;
}
