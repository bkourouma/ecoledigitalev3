import { requirePermission } from "@/platform/auth/server";
import { TimetableScreen } from "../../schedule/_components/TimetableScreen";

export default async function TeacherSchedulePage() {
  await requirePermission("schedule.own.read");
  return <TimetableScreen exportHref="/v2/teacher/schedule/export" />;
}
