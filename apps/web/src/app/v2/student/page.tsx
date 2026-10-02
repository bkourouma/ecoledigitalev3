import { requirePermission } from "@/platform/auth/server";
import { StudentHome } from "./_components/StudentScreens";

export default async function StudentHomePage() {
  await requirePermission("student.self.read");
  return <StudentHome />;
}
