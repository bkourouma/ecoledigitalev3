import { requirePermission } from "@/platform/auth/server";
import { TeacherClasses } from "../_components/TeacherClasses";

export default async function TeacherClassesPage() {
  await requirePermission("staff.own.read");
  return <TeacherClasses />;
}
