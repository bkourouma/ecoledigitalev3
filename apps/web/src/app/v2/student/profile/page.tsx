import { requirePermission } from "@/platform/auth/server";
import { StudentProfile } from "../_components/StudentScreens";

export default async function StudentProfilePage() {
  await requirePermission("student.self.read");
  return <StudentProfile />;
}
