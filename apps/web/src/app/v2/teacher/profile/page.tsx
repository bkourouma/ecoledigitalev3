import { requirePermission } from "@/platform/auth/server";
import { TeacherProfile } from "../_components/TeacherProfile";

export default async function TeacherProfilePage() {
  await requirePermission("staff.own.read");
  return <TeacherProfile />;
}
