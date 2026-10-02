import { requireAnyPermission } from "@/platform/auth/any-permission";
import { StudentResults } from "../_components/StudentScreens";

export default async function StudentResultsPage() {
  await requireAnyPermission("grade.self.read", "result.self.read");
  return <StudentResults />;
}
